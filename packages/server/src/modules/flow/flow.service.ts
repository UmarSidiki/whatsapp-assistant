import { logger } from "../../core/logger";
import { ServiceError, getSocketFor, jidToContactId, toJid } from "../whatsapp/wa-socket";
import { db } from "../../database";
import { chatbotFlow, messageLog } from "../../database/schema";
import { eq, and, desc } from "drizzle-orm";

// ─── Flow Types ───────────────────────────────────────────────────────────────

export interface FlowNodeData {
  label?: string;
  // Trigger node
  keyword?: string;
  matchType?: "exact" | "contains" | "startsWith" | "regex";
  // Condition node
  conditionField?: "message" | "sender";
  conditionOperator?: "equals" | "contains" | "startsWith" | "regex" | "notContains";
  conditionValue?: string;
  // Message node
  messageText?: string;
  // Buttons node
  buttonText?: string;
  buttonFooter?: string;
  buttons?: FlowButton[];
  // Delay node
  delaySeconds?: number;
}

export interface FlowButton {
  id: string;
  type: "reply" | "url" | "call";
  text: string;
  url?: string;
  phoneNumber?: string;
}

export interface FlowNode {
  id: string;
  type: "trigger" | "condition" | "message" | "buttons" | "delay";
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

// ─── CRUD ─────────────────────────────────────────────────────────────────────

export async function getFlows(userId: string): Promise<ChatbotFlow[]> {
  const rows = await db
    .select()
    .from(chatbotFlow)
    .where(eq(chatbotFlow.userId, userId))
    .orderBy(desc(chatbotFlow.priority))
    .all();

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    flowData: JSON.parse(r.flowData) as FlowDefinition,
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
    flowData: JSON.parse(row.flowData) as FlowDefinition,
    enabled: row.enabled,
    priority: row.priority,
  };
}

export async function createFlow(
  userId: string,
  data: { name: string; description?: string; flowData: FlowDefinition; priority?: number }
): Promise<ChatbotFlow> {
  const now = new Date();
  const id = crypto.randomUUID();
  const flow: ChatbotFlow = {
    id,
    name: data.name,
    description: data.description ?? null,
    flowData: data.flowData,
    enabled: true,
    priority: data.priority ?? 0,
  };

  await db.insert(chatbotFlow).values({
    id,
    userId,
    name: data.name,
    description: data.description ?? null,
    flowData: JSON.stringify(data.flowData),
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
  if (data.flowData !== undefined) updates.flowData = JSON.stringify(data.flowData);
  if (data.enabled !== undefined) updates.enabled = data.enabled;
  if (data.priority !== undefined) updates.priority = data.priority;

  await db.update(chatbotFlow).set(updates).where(eq(chatbotFlow.id, id));

  return {
    ...existing,
    ...data,
  };
}

export async function deleteFlow(userId: string, id: string): Promise<void> {
  const [existing] = await db
    .select()
    .from(chatbotFlow)
    .where(and(eq(chatbotFlow.id, id), eq(chatbotFlow.userId, userId)));
  if (!existing) throw new ServiceError("Flow not found", 404);
  await db.delete(chatbotFlow).where(eq(chatbotFlow.id, id));
}

// ─── Flow Execution Engine ────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

interface ExecutionContext {
  userId: string;
  jid: string;
  incomingMessage: string;
  senderPhone: string;
}

/**
 * Execute all enabled flows for a user against an incoming message.
 * Returns true if any flow matched and executed, false otherwise.
 */
export async function executeFlows(
  userId: string,
  jid: string,
  text: string
): Promise<boolean> {
  const flows = await getFlows(userId);
  const enabledFlows = flows.filter((f) => f.enabled);

  for (const flow of enabledFlows) {
    const triggerNodes = flow.flowData.nodes.filter((n) => n.type === "trigger");

    for (const trigger of triggerNodes) {
      if (matchesTrigger(trigger, text)) {
        const ctx: ExecutionContext = {
          userId,
          jid,
          incomingMessage: text,
          senderPhone: jidToContactId(jid),
        };

        try {
          await executeFromNode(flow.flowData, trigger.id, ctx);
          logger.info("Flow executed", {
            userId,
            flowId: flow.id,
            flowName: flow.name,
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

function matchesTrigger(trigger: FlowNode, text: string): boolean {
  const keyword = trigger.data.keyword?.toLowerCase() ?? "";
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

    case "buttons": {
      if (node.data.buttonText && node.data.buttons?.length) {
        await sendButtonMessage(ctx, node.data);
      }
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
    .replace(/\{phone\}/g, ctx.senderPhone);
}

// ─── CTA Button Sending ──────────────────────────────────────────────────────

async function sendButtonMessage(ctx: ExecutionContext, data: FlowNodeData): Promise<void> {
  const socket = getSocketFor(ctx.userId);
  const text = interpolateFlowVars(data.buttonText ?? "", ctx);
  const footer = data.buttonFooter ? interpolateFlowVars(data.buttonFooter, ctx) : undefined;
  const buttons = data.buttons ?? [];

  // Separate button types
  const urlButtons = buttons.filter((b) => b.type === "url");
  const callButtons = buttons.filter((b) => b.type === "call");
  const replyButtons = buttons.filter((b) => b.type === "reply");

  // Use interactive message format for CTA buttons
  const interactiveMessage = buildInteractiveMessage(text, footer, urlButtons, callButtons, replyButtons);

  await socket.sendMessage(ctx.jid, interactiveMessage as any);

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

function buildInteractiveMessage(
  bodyText: string,
  footerText: string | undefined,
  urlButtons: FlowButton[],
  callButtons: FlowButton[],
  replyButtons: FlowButton[]
) {
  const nativeButtons = replyButtons.map((b, i) => ({
    name: "quick_reply",
    buttonParamsJson: JSON.stringify({
      display_text: b.text,
      id: b.id || `reply_${i}`,
    }),
  }));

  const ctaButtons = [
    ...urlButtons.map((b) => ({
      name: "cta_url",
      buttonParamsJson: JSON.stringify({
        display_text: b.text,
        url: b.url ?? "",
        merchant_url: b.url ?? "",
      }),
    })),
    ...callButtons.map((b) => ({
      name: "cta_call",
      buttonParamsJson: JSON.stringify({
        display_text: b.text,
        phone_number: b.phoneNumber ?? "",
      }),
    })),
  ];

  const allButtons = [...nativeButtons, ...ctaButtons];

  return {
    viewOnceMessage: {
      message: {
        interactiveMessage: {
          body: { text: bodyText },
          ...(footerText ? { footer: { text: footerText } } : {}),
          header: { hasMediaAttachment: false },
          nativeFlowMessage: {
            buttons: allButtons,
            messageParamsJson: "",
          },
        },
      },
    },
  };
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
  const urlButtons = buttons.filter((b) => b.type === "url");
  const callButtons = buttons.filter((b) => b.type === "call");
  const replyButtons = buttons.filter((b) => b.type === "reply");
  const msg = buildInteractiveMessage(text, footer, urlButtons, callButtons, replyButtons);
  await socket.sendMessage(jid, msg as any);
}
