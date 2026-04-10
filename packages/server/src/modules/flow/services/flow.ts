import { logger } from "../../../core/logger";
import { ServiceError, getSocketFor, jidToContactId, toJid, resolvePhoneNumber } from "../../whatsapp/services";
import { db } from "../../../database";
import { chatbotFlow, messageLog, flowTriggerState } from "../../../database";
import { eq, and, desc } from "drizzle-orm";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  generateWAMessageFromContent,
  normalizeMessageContent,
  isJidGroup,
  generateMessageIDV2,
  type BinaryNode,
} from "@whiskeysockets/baileys";

// ─── Flow Types ───────────────────────────────────────────────────────────────

export interface FlowNodeData {
  label?: string;
  // Trigger node
  triggerMode?: "keyword" | "everyMessage" | "inactivitySession";
  keyword?: string;
  matchType?: "exact" | "contains" | "startsWith" | "regex";
  inactivitySeconds?: number;
  // Condition node
  conditionField?: "message" | "sender";
  conditionOperator?: "equals" | "contains" | "startsWith" | "regex" | "notContains";
  conditionValue?: string;
  // Message node
  messageText?: string;
  // Image node
  imageSource?: "url" | "upload";
  imageUrl?: string;
  imageCaption?: string;
  imageAssetId?: string;
  imageMimeType?: string;
  imageFileName?: string;
  // Buttons node
  buttonText?: string;
  buttonFooter?: string;
  buttons?: FlowButton[];
  // Delay node
  delaySeconds?: number;
}

export interface ListRow {
  id: string;
  title: string;
  description?: string;
  header?: string;
}

export interface ListSection {
  title?: string;
  rows: ListRow[];
}

export interface FlowButton {
  id: string;
  type: "reply" | "url" | "call" | "copy" | "list" | "catalog" | "location";
  text: string;
  url?: string;
  phoneNumber?: string;
  copyCode?: string;
  // List (single_select) fields
  listTitle?: string;
  listSections?: ListSection[];
}

export interface FlowNode {
  id: string;
  type: "trigger" | "condition" | "message" | "image" | "buttons" | "delay";
  position: { x: number; y: number };
  data: FlowNodeData;
}

export interface FlowEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  label?: string;
}

export interface FlowDefinition {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

export interface ChatbotFlow {
  id: string;
  name: string;
  description?: string | null;
  flowData: FlowDefinition;
  enabled: boolean;
  priority: number;
}

export interface UploadedFlowImage {
  assetId: string;
  imageUrl: string;
  fileName: string;
  mimeType: string;
  size: number;
}

const IMAGE_UPLOAD_MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const INACTIVITY_DEFAULT_SECONDS = 12 * 60 * 60;
const INACTIVITY_MIN_SECONDS = 60;
const INACTIVITY_MAX_SECONDS = 30 * 24 * 60 * 60;
const IMAGE_STORAGE_ROOT = path.resolve(process.cwd(), "storage", "flow-images");

function isAllowedNodeType(type: string): type is FlowNode["type"] {
  return ["trigger", "condition", "message", "image", "buttons", "delay"].includes(type);
}

function normalizeFlowNodeData(type: FlowNode["type"], data: FlowNodeData): FlowNodeData {
  if (type === "trigger") {
    const triggerMode = data.triggerMode ?? "keyword";
    return {
      ...data,
      triggerMode,
      matchType: data.matchType ?? "contains",
      inactivitySeconds: Math.max(
        INACTIVITY_MIN_SECONDS,
        Math.min(INACTIVITY_MAX_SECONDS, data.inactivitySeconds ?? INACTIVITY_DEFAULT_SECONDS)
      ),
    };
  }

  if (type === "image") {
    const imageSource = data.imageSource ?? (data.imageAssetId ? "upload" : "url");
    return { ...data, imageSource };
  }

  if (type === "delay") {
    return {
      ...data,
      delaySeconds: Math.max(1, Math.min(300, Number(data.delaySeconds ?? 1) || 1)),
    };
  }

  return { ...data };
}

export function normalizeFlowDefinition(flowData: FlowDefinition): FlowDefinition {
  const nodes = Array.isArray(flowData?.nodes) ? flowData.nodes : [];
  const edges = Array.isArray(flowData?.edges) ? flowData.edges : [];

  return {
    nodes: nodes
      .filter((node): node is FlowNode => Boolean(node?.id && node?.type && isAllowedNodeType(node.type)))
      .map((node) => ({
        ...node,
        data: normalizeFlowNodeData(node.type, node.data ?? {}),
      })),
    edges: edges.filter((edge): edge is FlowEdge => Boolean(edge?.id && edge?.source && edge?.target)),
  };
}

function parseStoredFlowDefinition(rawFlowData: string): FlowDefinition {
  const parsed = JSON.parse(rawFlowData) as FlowDefinition;
  return normalizeFlowDefinition(parsed);
}

export function validateFlowDefinition(flowData: FlowDefinition): void {
  if (!flowData?.nodes?.length) throw new ServiceError("Flow must have at least one node", 400);
  if (!Array.isArray(flowData.edges)) throw new ServiceError("Flow edges must be an array", 400);

  const nodeIds = new Set<string>();
  for (const node of flowData.nodes) {
    if (!node.id?.trim()) throw new ServiceError("Each node must have an id", 400);
    if (!isAllowedNodeType(node.type)) throw new ServiceError(`Unsupported node type: ${String(node.type)}`, 400);
    if (nodeIds.has(node.id)) throw new ServiceError(`Duplicate node id: ${node.id}`, 400);
    nodeIds.add(node.id);
  }

  for (const edge of flowData.edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
      throw new ServiceError("Flow contains edge(s) that point to missing nodes", 400);
    }
  }

  if (!flowData.nodes.some((node) => node.type === "trigger")) {
    throw new ServiceError("Flow must include at least one Trigger node", 400);
  }

  for (const node of flowData.nodes) {
    if (node.type === "trigger") {
      const triggerMode = node.data.triggerMode ?? "keyword";
      if (!["keyword", "everyMessage", "inactivitySession"].includes(triggerMode)) {
        throw new ServiceError("Invalid trigger mode", 400);
      }
      if (triggerMode === "keyword" && !node.data.keyword?.trim()) {
        throw new ServiceError("Keyword trigger requires a keyword", 400);
      }
      if (triggerMode === "inactivitySession") {
        const inactivitySeconds = Number(node.data.inactivitySeconds ?? INACTIVITY_DEFAULT_SECONDS);
        if (!Number.isFinite(inactivitySeconds) || inactivitySeconds < INACTIVITY_MIN_SECONDS || inactivitySeconds > INACTIVITY_MAX_SECONDS) {
          throw new ServiceError("Inactivity window must be between 1 minute and 30 days", 400);
        }
      }
    }

    if (node.type === "image") {
      const source = node.data.imageSource ?? "url";
      if (source === "url") {
        if (!node.data.imageUrl?.trim()) {
          throw new ServiceError("Image node requires an image URL", 400);
        }
      } else if (source === "upload") {
        if (!node.data.imageAssetId?.trim()) {
          throw new ServiceError("Uploaded image node requires an image asset", 400);
        }
      } else {
        throw new ServiceError("Invalid image source type", 400);
      }
    }

    if (node.type === "delay") {
      const delaySeconds = Number(node.data.delaySeconds ?? 1);
      if (!Number.isFinite(delaySeconds) || delaySeconds < 1 || delaySeconds > 300) {
        throw new ServiceError("Delay must be between 1 and 300 seconds", 400);
      }
    }
  }
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

export async function getFlows(userId: string): Promise<ChatbotFlow[]> {
  const rows = await db
    .select()
    .from(chatbotFlow)
    .where(eq(chatbotFlow.userId, userId))
    .orderBy(desc(chatbotFlow.priority));

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    flowData: parseStoredFlowDefinition(r.flowData),
    enabled: r.enabled,
    priority: r.priority,
  }));
}

export async function getFlow(userId: string, id: string): Promise<ChatbotFlow> {
  const [row] = await db
    .select()
    .from(chatbotFlow)
    .where(and(eq(chatbotFlow.id, id), eq(chatbotFlow.userId, userId)));
  if (!row) throw new ServiceError("Flow not found", 404);

  return {
    id: row.id,
    name: row.name,
    description: row.description,
    flowData: parseStoredFlowDefinition(row.flowData),
    enabled: row.enabled,
    priority: row.priority,
  };
}

export async function createFlow(
  userId: string,
  data: { name: string; description?: string; flowData: FlowDefinition; priority?: number }
): Promise<ChatbotFlow> {
  const normalizedFlowData = normalizeFlowDefinition(data.flowData);
  validateFlowDefinition(normalizedFlowData);

  const now = new Date();
  const id = crypto.randomUUID();
  const flow: ChatbotFlow = {
    id,
    name: data.name,
    description: data.description ?? null,
    flowData: normalizedFlowData,
    enabled: true,
    priority: data.priority ?? 0,
  };

  await db.insert(chatbotFlow).values({
    id,
    userId,
    name: data.name,
    description: data.description ?? null,
    flowData: JSON.stringify(normalizedFlowData),
    enabled: true,
    priority: data.priority ?? 0,
    createdAt: now,
    updatedAt: now,
  });

  return flow;
}

export async function updateFlow(
  userId: string,
  id: string,
  data: Partial<{ name: string; description: string; flowData: FlowDefinition; enabled: boolean; priority: number }>
): Promise<ChatbotFlow> {
  const existing = await getFlow(userId, id);

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (data.name !== undefined) updates.name = data.name;
  if (data.description !== undefined) updates.description = data.description;
  const normalizedFlowData = data.flowData !== undefined ? normalizeFlowDefinition(data.flowData) : undefined;
  if (normalizedFlowData !== undefined) {
    validateFlowDefinition(normalizedFlowData);
    updates.flowData = JSON.stringify(normalizedFlowData);
  }
  if (data.enabled !== undefined) updates.enabled = data.enabled;
  if (data.priority !== undefined) updates.priority = data.priority;

  await db.update(chatbotFlow).set(updates).where(eq(chatbotFlow.id, id));

  return {
    ...existing,
    ...data,
    ...(normalizedFlowData ? { flowData: normalizedFlowData } : {}),
  };
}

export async function deleteFlow(userId: string, id: string): Promise<void> {
  const [existing] = await db
    .select()
    .from(chatbotFlow)
    .where(and(eq(chatbotFlow.id, id), eq(chatbotFlow.userId, userId)));
  if (!existing) throw new ServiceError("Flow not found", 404);
  await db
    .delete(flowTriggerState)
    .where(and(eq(flowTriggerState.userId, userId), eq(flowTriggerState.flowId, id)));
  await db.delete(chatbotFlow).where(eq(chatbotFlow.id, id));
}

function sanitizeUserPathSegment(userId: string): string {
  return userId.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function getUserImageDirectory(userId: string): string {
  return path.join(IMAGE_STORAGE_ROOT, sanitizeUserPathSegment(userId));
}

function getImageAssetPath(userId: string, assetId: string): string {
  return path.join(getUserImageDirectory(userId), assetId);
}

function guessExtFromMimeType(mimeType: string): string | null {
  switch (mimeType) {
    case "image/jpeg":
      return ".jpg";
    case "image/png":
      return ".png";
    case "image/webp":
      return ".webp";
    case "image/gif":
      return ".gif";
    default:
      return null;
  }
}

function getMimeTypeFromExt(ext: string): string {
  switch (ext.toLowerCase()) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    default:
      return "application/octet-stream";
  }
}

function toFlowImageUrl(assetId: string): string {
  return `/api/whatsapp/flows/images/${encodeURIComponent(assetId)}`;
}

export async function uploadFlowImage(
  userId: string,
  file: { type?: string; name?: string; size?: number; arrayBuffer: () => Promise<ArrayBuffer> }
): Promise<UploadedFlowImage> {
  const mimeType = String(file.type ?? "").toLowerCase();
  if (!mimeType.startsWith("image/")) {
    throw new ServiceError("Only image files are allowed", 400);
  }
  const ext = guessExtFromMimeType(mimeType);
  if (!ext) {
    throw new ServiceError("Only JPG, PNG, GIF and WEBP are supported", 400);
  }
  const size = Number(file.size ?? 0);
  if (!Number.isFinite(size) || size <= 0) {
    throw new ServiceError("Image file is empty", 400);
  }
  if (size > IMAGE_UPLOAD_MAX_BYTES) {
    throw new ServiceError("Image exceeds 5 MB limit", 400);
  }

  const assetId = `${Date.now()}_${crypto.randomUUID()}${ext}`;
  const userDir = getUserImageDirectory(userId);
  const assetPath = getImageAssetPath(userId, assetId);
  await mkdir(userDir, { recursive: true });
  const content = Buffer.from(await file.arrayBuffer());
  await writeFile(assetPath, content);

  return {
    assetId,
    imageUrl: toFlowImageUrl(assetId),
    fileName: file.name || `image${ext}`,
    mimeType,
    size,
  };
}

export async function getFlowImageAsset(
  userId: string,
  assetId: string
): Promise<{ buffer: Buffer; mimeType: string }> {
  const normalizedAssetId = assetId.trim();
  if (
    !normalizedAssetId ||
    normalizedAssetId.includes("..") ||
    normalizedAssetId.includes("/") ||
    normalizedAssetId.includes("\\") ||
    !/^[a-zA-Z0-9._-]+$/.test(normalizedAssetId)
  ) {
    throw new ServiceError("Invalid image asset id", 400);
  }
  const assetPath = getImageAssetPath(userId, normalizedAssetId);
  if (!existsSync(assetPath)) {
    throw new ServiceError("Image asset not found", 404);
  }
  const buffer = await readFile(assetPath);
  const mimeType = getMimeTypeFromExt(path.extname(assetPath));
  return { buffer, mimeType };
}

// ─── Flow Execution Engine ────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

interface ExecutionContext {
  userId: string;
  jid: string;
  incomingMessage: string;
  senderPhone: string;
  /** Actual phone number (resolved from LID if needed). Falls back to senderPhone. */
  resolvedPhone: string;
}

// ─── Pending Button Response Tracking ─────────────────────────────────────────

interface PendingButtonSession {
  flowData: FlowDefinition;
  buttonsNodeId: string;
  buttons: FlowButton[];
  timestamp: number;
  ctx: ExecutionContext;
}

const pendingButtonResponses = new Map<string, PendingButtonSession>();
const PENDING_TTL_MS = 5 * 60 * 1000; // 5 minutes

function pendingKey(userId: string, contactPhone: string): string {
  return `${userId}_${contactPhone}`;
}

// Periodically clean expired pending sessions
setInterval(() => {
  const now = Date.now();
  for (const [key, session] of Array.from(pendingButtonResponses.entries())) {
    if (now - session.timestamp > PENDING_TTL_MS) {
      pendingButtonResponses.delete(key);
    }
  }
}, 60_000).unref?.();

/**
 * Execute all enabled flows for a user against an incoming message.
 * Returns true if any flow matched and executed, false otherwise.
 */
export async function executeFlows(
  userId: string,
  jid: string,
  text: string,
  options?: { receivedAt?: Date }
): Promise<boolean> {
  // Check pending button replies first (highest priority)
  const buttonHandled = await handleButtonReply(userId, jid, text);
  if (buttonHandled) return true;

  const receivedAt = options?.receivedAt ?? new Date();
  const flows = await getFlows(userId);
  const enabledFlows = flows.filter((f) => f.enabled);
  const contactId = jidToContactId(jid);

  for (const flow of enabledFlows) {
    const triggerNodes = flow.flowData.nodes.filter((n) => n.type === "trigger");

    for (const trigger of triggerNodes) {
      const matched = await matchesTrigger({
        userId,
        flowId: flow.id,
        trigger,
        contactPhone: contactId,
        text,
        receivedAt,
      });

      if (matched) {
        const phone = await resolvePhoneNumber(userId, jid);
        const ctx: ExecutionContext = {
          userId,
          jid,
          incomingMessage: text,
          senderPhone: contactId,
          resolvedPhone: phone,
        };

        try {
          await executeFromNode(flow.flowData, trigger.id, ctx);
          logger.info("Flow executed", {
            userId,
            flowId: flow.id,
            flowName: flow.name,
            triggerMode: trigger.data.triggerMode ?? "keyword",
            trigger: trigger.data.keyword,
          });
        } catch (e) {
          logger.error("Flow execution failed", {
            userId,
            flowId: flow.id,
            error: String(e),
          });
        }
        return true; // first matching flow wins
      }
    }
  }

  return false;
}

/**
 * Handle an incoming message that might be a reply to previously sent buttons.
 * Returns true if it matched a pending button reply and executed the branch.
 */
export async function handleButtonReply(
  userId: string,
  jid: string,
  text: string
): Promise<boolean> {
  const contactPhone = jidToContactId(jid);
  const key = pendingKey(userId, contactPhone);
  const session = pendingButtonResponses.get(key);

  if (!session) return false;

  // Check if expired
  if (Date.now() - session.timestamp > PENDING_TTL_MS) {
    pendingButtonResponses.delete(key);
    return false;
  }

  // Find matching reply button by text (case-insensitive, skip empty)
  const matchedButton = session.buttons.find(
    (b) => b.type === "reply" && b.text.trim() && b.text.toLowerCase() === text.toLowerCase()
  );

  if (!matchedButton) return false;

  // Consume the pending session
  pendingButtonResponses.delete(key);

  // Resume flow from the matched button's output handle
  const buttonHandle = `btn_${matchedButton.id}`;
  const nextNodes = getNextNodes(session.flowData, session.buttonsNodeId, buttonHandle);

  const ctx: ExecutionContext = {
    ...session.ctx,
    incomingMessage: text,
  };

  logger.info("Button reply matched", {
    userId,
    buttonText: matchedButton.text,
    buttonId: matchedButton.id,
    nextNodeCount: nextNodes.length,
  });

  const visited = new Set<string>();
  for (const next of nextNodes) {
    await executeFromNode(session.flowData, next.id, ctx, visited);
  }

  return true;
}

interface TriggerMatchArgs {
  userId: string;
  flowId: string;
  trigger: FlowNode;
  contactPhone: string;
  text: string;
  receivedAt: Date;
}

function matchesKeywordTrigger(trigger: FlowNode, text: string): boolean {
  const keyword = trigger.data.keyword?.toLowerCase() ?? "";
  if (!keyword) return false; // skip empty triggers
  const t = text.toLowerCase();
  const matchType = trigger.data.matchType ?? "contains";

  switch (matchType) {
    case "exact":
      return t === keyword;
    case "contains":
      return t.includes(keyword);
    case "startsWith":
      return t.startsWith(keyword);
    case "regex":
      try {
        return new RegExp(keyword, "i").test(text);
      } catch {
        return false;
      }
    default:
      return false;
  }
}

async function matchesInactivitySessionTrigger(args: {
  userId: string;
  flowId: string;
  triggerNodeId: string;
  contactPhone: string;
  inactivitySeconds: number;
  receivedAt: Date;
}): Promise<boolean> {
  const [state] = await db
    .select()
    .from(flowTriggerState)
    .where(
      and(
        eq(flowTriggerState.userId, args.userId),
        eq(flowTriggerState.flowId, args.flowId),
        eq(flowTriggerState.triggerNodeId, args.triggerNodeId),
        eq(flowTriggerState.contactPhone, args.contactPhone)
      )
    );

  const now = args.receivedAt;
  const inactivityMs = args.inactivitySeconds * 1000;
  let shouldTrigger = true;
  let isSessionActive = true;

  if (state) {
    const gapMs = now.getTime() - state.lastMessageAt.getTime();
    const isInactiveGap = gapMs > inactivityMs;
    shouldTrigger = isInactiveGap;
    isSessionActive = !isInactiveGap;
  }

  await db
    .insert(flowTriggerState)
    .values({
      id: state?.id ?? crypto.randomUUID(),
      userId: args.userId,
      flowId: args.flowId,
      triggerNodeId: args.triggerNodeId,
      contactPhone: args.contactPhone,
      lastMessageAt: now,
      sessionActive: isSessionActive,
      createdAt: state?.createdAt ?? now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        flowTriggerState.userId,
        flowTriggerState.flowId,
        flowTriggerState.triggerNodeId,
        flowTriggerState.contactPhone,
      ],
      set: {
        lastMessageAt: now,
        sessionActive: isSessionActive,
        updatedAt: now,
      },
    });

  return shouldTrigger;
}

async function matchesTrigger(args: TriggerMatchArgs): Promise<boolean> {
  const triggerMode = args.trigger.data.triggerMode ?? "keyword";
  switch (triggerMode) {
    case "everyMessage":
      return true;
    case "inactivitySession": {
      const inactivitySeconds = Math.max(
        INACTIVITY_MIN_SECONDS,
        Math.min(INACTIVITY_MAX_SECONDS, args.trigger.data.inactivitySeconds ?? INACTIVITY_DEFAULT_SECONDS)
      );
      return matchesInactivitySessionTrigger({
        userId: args.userId,
        flowId: args.flowId,
        triggerNodeId: args.trigger.id,
        contactPhone: args.contactPhone,
        inactivitySeconds,
        receivedAt: args.receivedAt,
      });
    }
    case "keyword":
    default:
      return matchesKeywordTrigger(args.trigger, args.text);
  }
}

function getNextNodes(flow: FlowDefinition, nodeId: string, sourceHandle?: string): FlowNode[] {
  const outEdges = flow.edges.filter(
    (e) => e.source === nodeId && (sourceHandle === undefined || e.sourceHandle === sourceHandle)
  );
  return outEdges
    .map((e) => flow.nodes.find((n) => n.id === e.target))
    .filter((n): n is FlowNode => n !== undefined);
}

async function executeFromNode(
  flow: FlowDefinition,
  nodeId: string,
  ctx: ExecutionContext,
  visited = new Set<string>()
): Promise<void> {
  if (visited.has(nodeId)) return; // prevent infinite loops
  visited.add(nodeId);

  const node = flow.nodes.find((n) => n.id === nodeId);
  if (!node) return;

  switch (node.type) {
    case "trigger": {
      // Trigger is just an entry point; continue to next nodes
      const nextNodes = getNextNodes(flow, nodeId);
      for (const next of nextNodes) {
        await executeFromNode(flow, next.id, ctx, visited);
      }
      break;
    }

    case "condition": {
      const result = evaluateCondition(node, ctx);
      // "yes" handle for true, "no" handle for false
      const handle = result ? "yes" : "no";
      const nextNodes = getNextNodes(flow, nodeId, handle);
      for (const next of nextNodes) {
        await executeFromNode(flow, next.id, ctx, visited);
      }
      break;
    }

    case "message": {
      if (node.data.messageText) {
        const text = interpolateFlowVars(node.data.messageText, ctx);
        const socket = getSocketFor(ctx.userId);
        await socket.sendMessage(ctx.jid, { text });

        await db.insert(messageLog).values({
          id: crypto.randomUUID(),
          userId: ctx.userId,
          type: "flow",
          phone: ctx.senderPhone,
          message: text,
          status: "sent",
          createdAt: new Date(),
        });
      }
      const nextNodes = getNextNodes(flow, nodeId);
      for (const next of nextNodes) {
        await executeFromNode(flow, next.id, ctx, visited);
      }
      break;
    }

    case "image": {
      await sendImageMessage(ctx, node.data);
      const nextNodes = getNextNodes(flow, nodeId);
      for (const next of nextNodes) {
        await executeFromNode(flow, next.id, ctx, visited);
      }
      break;
    }

    case "buttons": {
      if (node.data.buttonText && node.data.buttons?.length) {
        await sendButtonMessage(ctx, node.data);

        // If there are reply buttons, store pending session and wait for reply
        const replyButtons = (node.data.buttons ?? []).filter((b) => b.type === "reply");
        if (replyButtons.length > 0) {
          const key = pendingKey(ctx.userId, ctx.senderPhone);
          pendingButtonResponses.set(key, {
            flowData: flow,
            buttonsNodeId: nodeId,
            buttons: node.data.buttons!,
            timestamp: Date.now(),
            ctx,
          });
          // Don't follow edges — wait for button reply
          break;
        }
      }
      // No reply buttons — continue to next nodes immediately
      const nextNodes = getNextNodes(flow, nodeId);
      for (const next of nextNodes) {
        await executeFromNode(flow, next.id, ctx, visited);
      }
      break;
    }

    case "delay": {
      const seconds = node.data.delaySeconds ?? 1;
      await sleep(seconds * 1000);
      const nextNodes = getNextNodes(flow, nodeId);
      for (const next of nextNodes) {
        await executeFromNode(flow, next.id, ctx, visited);
      }
      break;
    }
  }
}

function evaluateCondition(node: FlowNode, ctx: ExecutionContext): boolean {
  const field = node.data.conditionField ?? "message";
  const operator = node.data.conditionOperator ?? "contains";
  const value = (node.data.conditionValue ?? "").toLowerCase();

  let fieldValue = "";
  switch (field) {
    case "message":
      fieldValue = ctx.incomingMessage.toLowerCase();
      break;
    case "sender":
      fieldValue = ctx.senderPhone.toLowerCase();
      break;
  }

  switch (operator) {
    case "equals":
      return fieldValue === value;
    case "contains":
      return fieldValue.includes(value);
    case "startsWith":
      return fieldValue.startsWith(value);
    case "notContains":
      return !fieldValue.includes(value);
    case "regex":
      try {
        return new RegExp(value, "i").test(fieldValue);
      } catch {
        return false;
      }
    default:
      return false;
  }
}

function interpolateFlowVars(text: string, ctx: ExecutionContext): string {
  return text
    .replace(/\{message\}/g, ctx.incomingMessage)
    .replace(/\{sender\}/g, ctx.senderPhone)
    .replace(/\{phone\}/g, ctx.resolvedPhone);
}

// ─── CTA Button Sending (direct Baileys relay with binary node injection) ────

function flowButtonsToNativeFlowButtons(buttons: FlowButton[]): Array<{ name: string; buttonParamsJson: string }> {
  return buttons.map((b, i) => {
    switch (b.type) {
      case "reply":
        return {
          name: "quick_reply",
          buttonParamsJson: JSON.stringify({
            display_text: b.text,
            id: b.id || `reply_${i}`,
          }),
        };
      case "url":
        return {
          name: "cta_url",
          buttonParamsJson: JSON.stringify({
            display_text: b.text,
            url: b.url ?? "",
            merchant_url: b.url ?? "",
          }),
        };
      case "call":
        return {
          name: "cta_call",
          buttonParamsJson: JSON.stringify({
            display_text: b.text,
            phone_number: b.phoneNumber ?? "",
          }),
        };
      case "copy":
        return {
          name: "cta_copy",
          buttonParamsJson: JSON.stringify({
            display_text: b.text,
            copy_code: b.copyCode ?? "",
          }),
        };
      case "list":
        return {
          name: "single_select",
          buttonParamsJson: JSON.stringify({
            title: b.listTitle || b.text || "Select",
            sections: b.listSections ?? [],
          }),
        };
      case "catalog":
        return {
          name: "cta_catalog",
          buttonParamsJson: JSON.stringify({
            display_text: b.text || "View Catalog",
          }),
        };
      case "location":
        return {
          name: "send_location",
          buttonParamsJson: JSON.stringify({
            display_text: b.text || "Share Location",
          }),
        };
      default:
        return {
          name: "quick_reply",
          buttonParamsJson: JSON.stringify({
            display_text: b.text,
            id: b.id || `btn_${i}`,
          }),
        };
    }
  });
}

/**
 * Build the binary node structure WhatsApp requires for interactive messages.
 */
function getButtonArgs(message: Record<string, unknown>): BinaryNode {
  const interactiveMsg = message.interactiveMessage as Record<string, unknown> | undefined;
  const nativeFlow = interactiveMsg?.nativeFlowMessage as Record<string, unknown> | undefined;

  if (nativeFlow) {
    const buttons = nativeFlow.buttons as Array<{ name?: string }> | undefined;
    const firstButtonName = buttons?.[0]?.name;
    if (firstButtonName === "review_and_pay" || firstButtonName === "payment_info") {
      return {
        tag: "biz",
        attrs: {
          native_flow_name: firstButtonName === "review_and_pay" ? "order_details" : firstButtonName,
        },
      };
    }

    const nativeFlowSpecials = new Set([
      "mpm",
      "cta_catalog",
      "send_location",
      "call_permission_request",
      "wa_payment_transaction_details",
      "automated_greeting_message_view_catalog",
    ]);
    const isSpecialNativeFlow = Boolean(
      firstButtonName && nativeFlowSpecials.has(firstButtonName)
    );
    const nativeFlowVersion = isSpecialNativeFlow ? "2" : "9";
    const nativeFlowName =
      isSpecialNativeFlow && firstButtonName ? firstButtonName : "mixed";

    return {
      tag: "biz",
      attrs: {},
      content: [{
        tag: "interactive",
        attrs: { type: "native_flow", v: "1" },
        content: [{
          tag: "native_flow",
          attrs: { v: nativeFlowVersion, name: nativeFlowName },
        }],
      }],
    };
  }

  return { tag: "biz", attrs: {} };
}

/**
 * Send an interactive message with CTA buttons using direct Baileys relayMessage.
 */
async function sendInteractiveMessage(
  sock: ReturnType<typeof getSocketFor>,
  jid: string,
  content: { text: string; footer?: string; nativeFlowButtons: Array<{ name: string; buttonParamsJson: string }> }
): Promise<void> {
  const interactiveMessage: Record<string, unknown> = {
    nativeFlowMessage: {
      buttons: content.nativeFlowButtons.map((btn) => ({
        name: btn.name,
        buttonParamsJson: btn.buttonParamsJson,
      })),
    },
    body: { text: content.text },
  };

  if (content.footer) {
    interactiveMessage.footer = { text: content.footer };
  }

  const userJid = sock.authState?.creds?.me?.id || sock.user?.id || "";
  const msgContent = { interactiveMessage };

  const fullMsg = generateWAMessageFromContent(jid, msgContent, {
    userJid,
    messageId: generateMessageIDV2(userJid || ""),
    timestamp: new Date(),
  });

  const normalized = normalizeMessageContent(fullMsg.message);
  const additionalNodes: BinaryNode[] = [];

  if (normalized) {
    const buttonsNode = getButtonArgs(normalized as Record<string, unknown>);
    additionalNodes.push(buttonsNode);
    if (!isJidGroup(jid)) {
      additionalNodes.push({ tag: "bot", attrs: { biz_bot: "1" } });
    }
  }

  await sock.relayMessage(jid, fullMsg.message!, {
    messageId: fullMsg.key.id!,
    additionalNodes,
  });
}

async function sendImageMessage(ctx: ExecutionContext, data: FlowNodeData): Promise<void> {
  const socket = getSocketFor(ctx.userId);
  const source = data.imageSource ?? (data.imageAssetId ? "upload" : "url");
  const caption = data.imageCaption ? interpolateFlowVars(data.imageCaption, ctx) : undefined;

  if (source === "upload") {
    const assetId = data.imageAssetId?.trim();
    if (!assetId) return;
    const { buffer } = await getFlowImageAsset(ctx.userId, assetId);
    await socket.sendMessage(ctx.jid, {
      image: buffer,
      ...(caption ? { caption } : {}),
    });
  } else {
    const imageUrl = interpolateFlowVars(data.imageUrl ?? "", ctx).trim();
    if (!imageUrl) return;
    await socket.sendMessage(ctx.jid, {
      image: { url: imageUrl },
      ...(caption ? { caption } : {}),
    });
  }

  await db.insert(messageLog).values({
    id: crypto.randomUUID(),
    userId: ctx.userId,
    type: "flow",
    phone: ctx.senderPhone,
    message: `[Image] ${caption || data.imageFileName || data.imageUrl || "Sent image"}`,
    status: "sent",
    createdAt: new Date(),
  });
}

async function sendButtonMessage(ctx: ExecutionContext, data: FlowNodeData): Promise<void> {
  const socket = getSocketFor(ctx.userId);
  const text = interpolateFlowVars(data.buttonText ?? "", ctx);
  const footer = data.buttonFooter ? interpolateFlowVars(data.buttonFooter, ctx) : undefined;
  const buttons = data.buttons ?? [];

  const nativeFlowButtons = flowButtonsToNativeFlowButtons(buttons);

  await sendInteractiveMessage(socket, ctx.jid, {
    text,
    ...(footer ? { footer } : {}),
    nativeFlowButtons,
  });

  await db.insert(messageLog).values({
    id: crypto.randomUUID(),
    userId: ctx.userId,
    type: "flow",
    phone: ctx.senderPhone,
    message: `[Buttons] ${text}`,
    status: "sent",
    createdAt: new Date(),
  });
}

/**
 * Standalone function to send a CTA button message (usable outside flows).
 */
export async function sendCtaButtonMessage(
  userId: string,
  jid: string,
  text: string,
  footer: string | undefined,
  buttons: FlowButton[]
): Promise<void> {
  const socket = getSocketFor(userId);
  const nativeFlowButtons = flowButtonsToNativeFlowButtons(buttons);

  await sendInteractiveMessage(socket, jid, {
    text,
    ...(footer ? { footer } : {}),
    nativeFlowButtons,
  });
}
