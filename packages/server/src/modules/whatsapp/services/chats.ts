import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { BufferJSON, downloadMediaMessage, type proto } from "@whiskeysockets/baileys";
import { createHash } from "node:crypto";
import { db, waChat, waChatMessage, waChatSettings } from "../../../database";
import { logger } from "../../../core/logger";
import { ServiceError } from "../types";
import type { DashboardChat, DashboardChatScope, DashboardChatType } from "../types/dashboard-chat";
import { normalizeChatId, resolveChatTypeFromJid } from "./chat-jid";
import {
  extractTextFromMessage,
  getContactName,
  getSessionIfExists,
  getSocketFor,
  jidToContactId,
  listKnownContacts,
  normalizeContactId,
  resolvePhoneNumber,
  toJid,
} from "./socket";
import { getLiveDashboardChats, getLiveThreadMessages } from "./live-chat-registry";
import pino from "pino";

export type { DashboardChat };
export type ChatType = DashboardChatType;
export type ChatScope = DashboardChatScope;

export const DEFAULT_CHAT_HISTORY_LIMIT = 1000;
const MIN_CHAT_HISTORY_LIMIT = 100;
const MAX_CHAT_HISTORY_LIMIT = 10000;
const warnedMissingRelations = new Set<string>();
const warnedOptionalWaColumns = new Set<string>();

function isUndefinedColumnError(error: unknown): boolean {
  let cur: unknown = error;
  for (let depth = 0; depth < 8 && cur; depth++) {
    if (
      typeof cur === "object" &&
      cur !== null &&
      "code" in cur &&
      String((cur as { code: unknown }).code) === "42703"
    ) {
      return true;
    }
    if (typeof cur === "object" && cur !== null && "cause" in cur) {
      cur = (cur as { cause: unknown }).cause;
      continue;
    }
    break;
  }
  return false;
}

function logOptionalWaColumnsOnce(scope: string, detail: string): void {
  if (warnedOptionalWaColumns.has(scope)) return;
  warnedOptionalWaColumns.add(scope);
  logger.warn("Optional wa_chat_message columns missing; run `bun run db:migrate` in packages/server for media fields.", {
    scope,
    detail,
  });
}

const MEDIA_DOWNLOAD_LOGGER = pino({ level: "silent" });

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function getNonEmptyString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function toNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function toEpochMs(value: unknown): number | undefined {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number" && Number.isFinite(value)) {
    return value < 1_000_000_000_000 ? value * 1000 : value;
  }
  if (typeof value === "string" && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric < 1_000_000_000_000 ? numeric * 1000 : numeric;
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return undefined;
}

function isMissingRelationError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "42P01"
  );
}

function logMissingRelationOnce(scope: string, error: unknown): void {
  if (warnedMissingRelations.has(scope)) return;
  warnedMissingRelations.add(scope);
  logger.warn("WhatsApp chat persistence tables missing; using fallback behavior", {
    scope,
    error: String(error),
  });
}

function getChatsFromStore(rawStore: unknown): Array<{ id: string; chat: Record<string, unknown> }> {
  if (rawStore instanceof Map) {
    return Array.from(rawStore.entries())
      .map(([id, chat]) => ({ id: String(id), chat: asRecord(chat) }))
      .filter((entry): entry is { id: string; chat: Record<string, unknown> } => Boolean(entry.chat));
  }

  if (Array.isArray(rawStore)) {
    return rawStore
      .map((chat) => {
        const record = asRecord(chat);
        if (!record) return null;
        const id = getNonEmptyString(record.id, record.jid);
        if (!id) return null;
        return { id, chat: record };
      })
      .filter((entry): entry is { id: string; chat: Record<string, unknown> } => entry !== null);
  }

  const record = asRecord(rawStore);
  if (!record) return [];
  return Object.entries(record)
    .map(([id, chat]) => ({ id, chat: asRecord(chat) }))
    .filter((entry): entry is { id: string; chat: Record<string, unknown> } => Boolean(entry.chat));
}

function resolveStoreLastMessage(chat: Record<string, unknown>): string | undefined {
  const messageRecord = asRecord(chat.lastMessage);
  const extracted = extractTextFromMessage((messageRecord?.message ?? chat.lastMessage) as proto.IMessage | undefined);
  const fallback = getNonEmptyString(chat.lastMessageText, chat.lastMsg, chat.conversation);
  const text = extracted || fallback;
  if (!text) return undefined;
  return text.length > 160 ? `${text.slice(0, 157)}...` : text;
}

function resolveStoreLastMessageAt(chat: Record<string, unknown>): string | undefined {
  const messageRecord = asRecord(chat.lastMessage);
  const epochMs =
    toEpochMs(chat.conversationTimestamp) ??
    toEpochMs(chat.lastMessageRecvTimestamp) ??
    toEpochMs(chat.lastMessageTimestamp) ??
    toEpochMs(chat.timestamp) ??
    toEpochMs(messageRecord?.messageTimestamp) ??
    toEpochMs(messageRecord?.timestamp);

  if (!epochMs) return undefined;
  return new Date(epochMs).toISOString();
}

function getScopeTypes(scope: ChatScope): ChatType[] {
  switch (scope) {
    case "direct":
      return ["direct"];
    case "communities":
      return ["group", "broadcast", "channel"];
    case "group":
    case "broadcast":
    case "channel":
      return [scope];
    case "all":
    default:
      return ["direct", "group", "broadcast", "channel"];
  }
}

function toChatScope(value: string | undefined): ChatScope {
  if (!value) return "direct";
  const normalized = value.trim().toLowerCase();
  const valid: Record<string, ChatScope> = {
    direct: "direct",
    communities: "communities",
    all: "all",
    group: "group",
    broadcast: "broadcast",
    channel: "channel",
  };
  const scope = valid[normalized];
  if (!scope) {
    throw new ServiceError("Invalid chats type filter", 400);
  }
  return scope;
}

export function parseChatsScope(value: string | undefined): ChatScope {
  return toChatScope(value);
}

export { normalizeChatId, resolveChatTypeFromJid } from "./chat-jid";

function toPersistedMessageText(message?: proto.IMessage | null): string | undefined {
  const text = extractTextFromMessage(message);
  if (text) return text;
  if (!message) return undefined;
  return "[Media]";
}

function buildMessageDedupeKey(input: {
  chatId: string;
  waMessageId?: string | null;
  sender: "me" | "contact";
  timestamp: Date;
  message: string;
  mediaKind?: string | null;
}): string {
  const waMessageId = input.waMessageId?.trim();
  if (waMessageId) {
    return `wa:${input.chatId}:${waMessageId}`;
  }

  const fingerprint = `${input.chatId}|${input.sender}|${input.timestamp.toISOString()}|${input.message}|${input.mediaKind ?? ""}`;
  const hash = createHash("sha1").update(fingerprint).digest("hex");
  return `fp:${hash}`;
}

function mediaKindForMessage(message?: proto.IMessage | null): "image" | "video" | "audio" | "voice" | "document" | "sticker" | null {
  if (!message) return null;
  if (message.imageMessage) return "image";
  if (message.videoMessage) return "video";
  if (message.audioMessage) return message.audioMessage.ptt ? "voice" : "audio";
  if (message.stickerMessage) return "sticker";
  if (message.documentMessage) return "document";
  return null;
}

function maybeSerializeWaDownloadPayload(msg: proto.IWebMessageInfo): {
  mediaKind: NonNullable<ReturnType<typeof mediaKindForMessage>>;
  payload: string;
} | null {
  const mediaKind = mediaKindForMessage(msg.message ?? undefined);
  if (!mediaKind) return null;
  try {
    const payload = JSON.stringify({ key: msg.key, message: msg.message }, BufferJSON.replacer);
    return { mediaKind, payload };
  } catch {
    return null;
  }
}

function parseIso(ts?: string): number {
  if (!ts) return 0;
  const n = Date.parse(ts);
  return Number.isNaN(n) ? 0 : n;
}

function mergeDashboardPair(a: DashboardChat, b: DashboardChat): DashboardChat {
  const aTs = parseIso(a.lastMessageAt);
  const bTs = parseIso(b.lastMessageAt);
  const newer = aTs >= bTs ? a : b;
  const older = aTs >= bTs ? b : a;
  const titleFrom = (c: DashboardChat) => (c.title && c.title !== c.id ? c.title : "");
  return {
    ...newer,
    messageCount: Math.max(a.messageCount ?? 0, b.messageCount ?? 0),
    unreadCount: Math.max(a.unreadCount ?? 0, b.unreadCount ?? 0),
    isPinned: Boolean(a.isPinned || b.isPinned),
    isArchived: Boolean(a.isArchived || b.isArchived),
    lastMessage: newer.lastMessage || older.lastMessage,
    lastMessageAt: aTs >= bTs ? a.lastMessageAt : b.lastMessageAt,
    title: titleFrom(newer) || titleFrom(older) || newer.title,
  };
}

export function mergeDashboardChatLists(...lists: DashboardChat[][]): DashboardChat[] {
  const map = new Map<string, DashboardChat>();
  for (const list of lists) {
    for (const c of list) {
      const key = normalizeChatId(c.id);
      const prev = map.get(key);
      map.set(key, prev ? mergeDashboardPair(prev, c) : c);
    }
  }
  return [...map.values()].sort((a, b) => {
    const aTs = parseIso(a.lastMessageAt);
    const bTs = parseIso(b.lastMessageAt);
    if (aTs !== bTs) return bTs - aTs;
    return a.title.localeCompare(b.title);
  });
}

function getContactsAsChats(userId: string, scope: ChatScope): DashboardChat[] {
  if (!(scope === "direct" || scope === "all")) {
    return [];
  }
  return listKnownContacts(userId).map(({ contactId, name }) => {
    const jid = toJid(contactId);
    return {
      id: jid,
      title: name || contactId,
      type: "direct",
      target: contactId,
      contactId,
      lastMessage: undefined,
      lastMessageAt: undefined,
      unreadCount: 0,
      isPinned: false,
      isArchived: false,
      messageCount: 0,
    } satisfies DashboardChat;
  });
}

function clampHistoryLimit(limit: number): number {
  return Math.max(MIN_CHAT_HISTORY_LIMIT, Math.min(MAX_CHAT_HISTORY_LIMIT, Math.floor(limit)));
}

export async function getChatHistoryLimit(userId: string): Promise<number> {
  try {
    const [settings] = await db
      .select({ historyLimit: waChatSettings.historyLimit })
      .from(waChatSettings)
      .where(eq(waChatSettings.userId, userId))
      .limit(1);

    return settings?.historyLimit ? clampHistoryLimit(settings.historyLimit) : DEFAULT_CHAT_HISTORY_LIMIT;
  } catch (error) {
    if (isMissingRelationError(error)) {
      logMissingRelationOnce("getChatHistoryLimit", error);
      return DEFAULT_CHAT_HISTORY_LIMIT;
    }
    throw error;
  }
}

export async function getChatSettings(userId: string): Promise<{ historyLimit: number }> {
  return { historyLimit: await getChatHistoryLimit(userId) };
}

export async function updateChatSettings(userId: string, historyLimit: number): Promise<{ historyLimit: number }> {
  if (!Number.isInteger(historyLimit)) {
    throw new ServiceError("historyLimit must be an integer", 400);
  }

  const normalizedLimit = clampHistoryLimit(historyLimit);
  const now = new Date();

  try {
    await db
      .insert(waChatSettings)
      .values({
        id: crypto.randomUUID(),
        userId,
        historyLimit: normalizedLimit,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: waChatSettings.userId,
        set: {
          historyLimit: normalizedLimit,
          updatedAt: now,
        },
      });
  } catch (error) {
    if (isMissingRelationError(error)) {
      logMissingRelationOnce("updateChatSettings", error);
      throw new ServiceError("Chat settings storage is not ready. Run database migrations.", 503);
    }
    throw error;
  }

  return { historyLimit: normalizedLimit };
}

export async function trimChatMessagesForChat(userId: string, chatId: string, historyLimit: number): Promise<void> {
  const normalizedLimit = Math.max(1, Math.floor(historyLimit));
  try {
    await db.delete(waChatMessage).where(sql`
      ${waChatMessage.userId} = ${userId}
      AND ${waChatMessage.chatId} = ${chatId}
      AND ${waChatMessage.id} IN (
        SELECT id
        FROM wa_chat_message
        WHERE "userId" = ${userId}
          AND "chatId" = ${chatId}
        ORDER BY "timestamp" DESC, id DESC
        LIMIT -1 OFFSET ${normalizedLimit}
      )
    `);
  } catch (error) {
    if (isMissingRelationError(error)) {
      logMissingRelationOnce("trimChatMessagesForChat", error);
      return;
    }
    throw error;
  }
}

// ─── Persistent Chat List ─────────────────────────────────────────────────────

/**
 * Upserts chat metadata from Baileys events into the persistent `wa_chat` table.
 * Each chat gets a composite key of `userId::chatId`.
 */
export async function persistChatsToDb(
  userId: string,
  chats: Array<{
    id?: string;
    jid?: string;
    name?: string;
    subject?: string;
    notify?: string;
    verifiedName?: string;
    short?: string;
    conversationTimestamp?: number | { low?: number; high?: number; unsigned?: boolean } | null;
    unreadCount?: number | null;
    lastMessage?: unknown;
  }>
): Promise<void> {
  const now = new Date();
  for (const chat of chats) {
    const chatId = normalizeChatId((chat.id || chat.jid) ?? "");
    if (!chatId) continue;
    const chatType = resolveChatTypeFromJid(chatId);
    if (!chatType) continue;

    const title =
      chat.name?.trim() ||
      chat.subject?.trim() ||
      chat.notify?.trim() ||
      chat.verifiedName?.trim() ||
      chat.short?.trim() ||
      (chatType === "direct" ? getContactName(userId, chatId) : "") ||
      undefined;

    const rawTs = chat.conversationTimestamp;
    let epochSec: number | undefined;
    if (typeof rawTs === "number" && rawTs > 0) {
      epochSec = rawTs;
    } else if (rawTs && typeof rawTs === "object" && "low" in rawTs) {
      epochSec = rawTs.low ?? undefined;
    }

    const pk = `${userId}::${chatId}`;

    try {
      await db
        .insert(waChat)
        .values({
          id: pk,
          userId,
          chatId,
          chatType,
          title: title || chatId,
          unreadCount: Math.max(0, Number(chat.unreadCount ?? 0)),
          conversationTimestamp: epochSec ?? null,
          lastMessageAt: epochSec ? new Date(epochSec * 1000) : null,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: waChat.id,
          set: {
            title: title ? sql`COALESCE(NULLIF(${title}, ''), ${waChat.title})` : waChat.title,
            unreadCount: chat.unreadCount != null ? Math.max(0, Number(chat.unreadCount)) : sql`${waChat.unreadCount}`,
            conversationTimestamp: epochSec ?? sql`${waChat.conversationTimestamp}`,
            lastMessageAt: epochSec ? new Date(epochSec * 1000) : sql`${waChat.lastMessageAt}`,
            updatedAt: now,
          },
        });
    } catch (e) {
      // best-effort — don't block the event handler
      logger.warn("Failed to persist chat", { userId, chatId, error: String(e) });
    }
  }
}

/**
 * Load all persisted chats of a scope from the `wa_chat` table.
 * Returns DashboardChat[] sorted by most recent activity.
 */
async function getPersistedChats(userId: string, scope: ChatScope): Promise<DashboardChat[]> {
  const types = getScopeTypes(scope);
  try {
    const whereClause =
      types.length === 1
        ? and(eq(waChat.userId, userId), eq(waChat.chatType, types[0]))!
        : and(eq(waChat.userId, userId), inArray(waChat.chatType, types))!;

    const rows = await db
      .select()
      .from(waChat)
      .where(whereClause)
      .orderBy(desc(waChat.lastMessageAt))
      .limit(300);

    return rows.map((r) => {
      const chatType = r.chatType as ChatType;
      const contactId =
        chatType === "direct" ? normalizeContactId(jidToContactId(r.chatId)) : "";
      return {
        id: r.chatId,
        title: r.title || getContactName(userId, r.chatId) || r.chatId,
        type: chatType,
        target: contactId || r.chatId,
        contactId: contactId || undefined,
        lastMessage: r.lastMessage ?? undefined,
        lastMessageAt: r.lastMessageAt ? r.lastMessageAt.toISOString() : undefined,
        unreadCount: r.unreadCount ?? 0,
        isPinned: false,
        isArchived: false,
        messageCount: 0,
      } satisfies DashboardChat;
    });
  } catch (error) {
    if (isMissingRelationError(error)) {
      logMissingRelationOnce("getPersistedChats", error);
      return [];
    }
    logger.warn("Failed to load persisted chats", { userId, error: String(error) });
    return [];
  }
}

export async function storeChatMessage(
  userId: string,
  input: {
    jid: string;
    message?: proto.IMessage | null;
    sender: "me" | "contact";
    timestamp: Date;
    title?: string;
    waMessageId?: string | null;
    waMessage?: proto.IWebMessageInfo | null;
  },
  options?: {
    skipTrim?: boolean;
    historyLimit?: number;
    source?: "history" | "realtime" | "api";
  }
): Promise<{ chatId: string; chatType: ChatType } | null> {
  const chatType = resolveChatTypeFromJid(input.jid);
  if (!chatType) return null;

  const chatId = normalizeChatId(input.jid);
  const persistedMessage = toPersistedMessageText(input.message);
  if (!persistedMessage) return null;

  const directContactId = chatType === "direct" ? normalizeContactId(jidToContactId(chatId)) : "";
  const derivedTitle =
    input.title?.trim() ||
    (chatType === "direct" ? getContactName(userId, input.jid) : "") ||
    chatId;

  const waPayload = input.waMessage ? maybeSerializeWaDownloadPayload(input.waMessage) : null;
  const waMessageId = input.waMessageId?.trim() || input.waMessage?.key?.id?.trim() || null;
  const dedupeKey = buildMessageDedupeKey({
    chatId,
    waMessageId,
    sender: input.sender,
    timestamp: input.timestamp,
    message: persistedMessage,
    mediaKind: waPayload?.mediaKind ?? null,
  });

  const baseRow = {
    id: crypto.randomUUID(),
    userId,
    chatId,
    chatType,
    contactPhone: directContactId || null,
    title: derivedTitle,
    message: persistedMessage,
    sender: input.sender,
    waMessageId,
    dedupeKey,
    source: options?.source ?? "realtime",
    timestamp: input.timestamp,
    createdAt: new Date(),
  };

  try {
    await db
      .insert(waChatMessage)
      .values({
        ...baseRow,
        waMessagePayload: waPayload?.payload,
        mediaKind: waPayload?.mediaKind ?? null,
      })
      .onConflictDoNothing({
        target: [waChatMessage.userId, waChatMessage.dedupeKey],
      });

    if (!options?.skipTrim) {
      const historyLimit = options?.historyLimit ?? (await getChatHistoryLimit(userId));
      await trimChatMessagesForChat(userId, chatId, historyLimit);
    }
  } catch (error) {
    if (isMissingRelationError(error)) {
      logMissingRelationOnce("storeChatMessage", error);
      return null;
    }
    if (isUndefinedColumnError(error)) {
      logOptionalWaColumnsOnce("storeChatMessage", String(error));
      try {
        await db.insert(waChatMessage).values(baseRow);
        if (!options?.skipTrim) {
          const historyLimit = options?.historyLimit ?? (await getChatHistoryLimit(userId));
          await trimChatMessagesForChat(userId, chatId, historyLimit);
        }
      } catch (e2) {
        if (isMissingRelationError(e2)) {
          logMissingRelationOnce("storeChatMessage", e2);
          return null;
        }
        throw e2;
      }
    } else {
      throw error;
    }
  }

  return { chatId, chatType };
}

function getChatsFromLiveStoreFallback(userId: string, scope: ChatScope): DashboardChat[] {
  const session = getSessionIfExists(userId);
  const sock = session?.socket as unknown as { store?: { chats?: unknown }; chats?: unknown } | undefined;
  const chats = getChatsFromStore(session?.store?.chats ?? sock?.store?.chats ?? sock?.chats);
  const allowedTypes = new Set(getScopeTypes(scope));

  const mapped = chats
    .map(({ id, chat }) => {
      const chatId = normalizeChatId(getNonEmptyString(chat.id, chat.jid, id) ?? "");
      const chatType = resolveChatTypeFromJid(chatId);
      if (!chatType || !allowedTypes.has(chatType)) return null;

      if (chatType === "direct") {
        const contactId = normalizeContactId(jidToContactId(chatId));
        return {
          id: chatId,
          title:
            getNonEmptyString(chat.name, chat.notify, chat.verifiedName, chat.short) ||
            getContactName(userId, chatId) ||
            chatId,
          type: chatType,
          target: contactId || chatId,
          contactId: contactId || undefined,
          lastMessage: resolveStoreLastMessage(chat),
          lastMessageAt: resolveStoreLastMessageAt(chat),
          unreadCount: Math.max(0, Math.floor(toNumber(chat.unreadCount ?? chat.unreadCounter))),
          isPinned: Boolean(toNumber(chat.pin) > 0 || chat.pinned),
          isArchived: Boolean(chat.archive ?? chat.archived),
          messageCount: 0,
        } satisfies DashboardChat;
      }

      return {
        id: chatId,
        title: getNonEmptyString(chat.name, chat.subject, chat.notify, chat.formattedTitle) || chatId,
        type: chatType,
        target: chatId,
        lastMessage: resolveStoreLastMessage(chat),
        lastMessageAt: resolveStoreLastMessageAt(chat),
        unreadCount: Math.max(0, Math.floor(toNumber(chat.unreadCount ?? chat.unreadCounter))),
        isPinned: Boolean(toNumber(chat.pin) > 0 || chat.pinned),
        isArchived: Boolean(chat.archive ?? chat.archived),
        messageCount: 0,
      } satisfies DashboardChat;
    })
    .filter(Boolean) as DashboardChat[];

  return mapped.sort((a, b) => {
    const aTs = a.lastMessageAt ? Date.parse(a.lastMessageAt) : 0;
    const bTs = b.lastMessageAt ? Date.parse(b.lastMessageAt) : 0;
    if (aTs !== bTs) return bTs - aTs;
    return a.title.localeCompare(b.title);
  });
}

export async function getChats(userId: string, scope: ChatScope = "direct"): Promise<DashboardChat[]> {
  let primary: DashboardChat[] = [];

  try {
    const types = getScopeTypes(scope);
    const whereClause =
      types.length === 1
        ? and(eq(waChatMessage.userId, userId), eq(waChatMessage.chatType, types[0]))!
        : and(eq(waChatMessage.userId, userId), inArray(waChatMessage.chatType, types))!;

    const grouped = await db
      .select({
        chatId: waChatMessage.chatId,
        chatType: waChatMessage.chatType,
        messageCount: sql<number>`count(*)`,
        lastMessageAt: sql<Date>`max(${waChatMessage.timestamp})`,
      })
      .from(waChatMessage)
      .where(whereClause)
      .groupBy(waChatMessage.chatId, waChatMessage.chatType)
      .orderBy(desc(sql<Date>`max(${waChatMessage.timestamp})`))
      .limit(200);

    const chatIds = grouped.map((row) => row.chatId);
    const latestPerChat = chatIds.length
      ? await db
          .selectDistinctOn([waChatMessage.chatId], {
            chatId: waChatMessage.chatId,
            title: waChatMessage.title,
            message: waChatMessage.message,
            timestamp: waChatMessage.timestamp,
          })
          .from(waChatMessage)
          .where(and(eq(waChatMessage.userId, userId), inArray(waChatMessage.chatId, chatIds)))
          .orderBy(waChatMessage.chatId, desc(waChatMessage.timestamp), desc(waChatMessage.id))
      : [];

    const latestMap = new Map(latestPerChat.map((row) => [row.chatId, row]));

    primary = grouped
      .map((row) => {
        const latest = latestMap.get(row.chatId);
        const chatType = row.chatType as ChatType;
        const lastMessageAt = row.lastMessageAt ? new Date(row.lastMessageAt).toISOString() : undefined;

        if (chatType === "direct") {
          const contactId = normalizeContactId(jidToContactId(row.chatId));
          const title = latest?.title?.trim() || getContactName(userId, row.chatId) || row.chatId;
          return {
            id: row.chatId,
            title,
            type: chatType,
            target: contactId || row.chatId,
            contactId: contactId || undefined,
            lastMessage: latest?.message,
            lastMessageAt,
            unreadCount: 0,
            isPinned: false,
            isArchived: false,
            messageCount: Number(row.messageCount ?? 0),
          } satisfies DashboardChat;
        }

        return {
          id: row.chatId,
          title: latest?.title?.trim() || row.chatId,
          type: chatType,
          target: row.chatId,
          lastMessage: latest?.message,
          lastMessageAt,
          unreadCount: 0,
          isPinned: false,
          isArchived: false,
          messageCount: Number(row.messageCount ?? 0),
        } satisfies DashboardChat;
      })
      .sort((a, b) => {
        const aTs = a.lastMessageAt ? Date.parse(a.lastMessageAt) : 0;
        const bTs = b.lastMessageAt ? Date.parse(b.lastMessageAt) : 0;
        if (aTs !== bTs) return bTs - aTs;
        return a.title.localeCompare(b.title);
      });
  } catch (error) {
    if (isMissingRelationError(error)) {
      logMissingRelationOnce("getChats", error);
      primary = getChatsFromLiveStoreFallback(userId, scope);
    } else {
      throw error;
    }
  }

  const live = getLiveDashboardChats(userId, scope);
  const legacy = getChatsFromLiveStoreFallback(userId, scope);
  const contactFallback = getContactsAsChats(userId, scope);

  // Load persisted chat list from DB (survives server restarts)
  let persisted: DashboardChat[] = [];
  try {
    persisted = await getPersistedChats(userId, scope);
  } catch {
    // best-effort
  }

  const merged = mergeDashboardChatLists(primary, live, legacy, persisted, contactFallback);

  return merged;
}

export interface ThreadMessageRow {
  id: string;
  sender: "me" | "contact";
  message: string;
  timestamp: string;
  mediaKind: string | null;
  hasMediaPayload: boolean;
}

export async function listThreadMessages(userId: string, chatId: string, limit = 150): Promise<ThreadMessageRow[]> {
  const normalized = normalizeChatId(chatId);
  const candidateIds = new Set<string>([normalized]);
  if (resolveChatTypeFromJid(normalized) === "direct") {
    try {
      const phone = await resolvePhoneNumber(userId, normalized);
      if (phone && !phone.includes("@")) {
        candidateIds.add(toJid(phone));
      }
    } catch {
      // best effort
    }
  }
  const candidateList = [...candidateIds];
  try {
    const rows = await db
      .select({
        id: waChatMessage.id,
        sender: waChatMessage.sender,
        message: waChatMessage.message,
        timestamp: waChatMessage.timestamp,
        mediaKind: waChatMessage.mediaKind,
        waMessagePayload: waChatMessage.waMessagePayload,
      })
      .from(waChatMessage)
      .where(
        and(
          eq(waChatMessage.userId, userId),
          candidateList.length === 1
            ? eq(waChatMessage.chatId, normalized)
            : inArray(waChatMessage.chatId, candidateList)
        )
      )
      .orderBy(asc(waChatMessage.timestamp), asc(waChatMessage.id))
      .limit(limit);

    if (rows.length === 0) {
      const liveRows = getLiveThreadMessages(userId, normalized, limit);
      if (liveRows.length > 0) {
        return liveRows.map((r) => ({ ...r }));
      }

      // No messages found — trigger an on-demand history sync from Baileys.
      // This sends a request to WhatsApp servers; the response arrives via
      // messaging-history.set event and will populate the DB for next load.
      try {
        const sock = getSocketFor(userId);
        await (sock as any).fetchMessageHistory(
          Math.min(limit, 50),
          { remoteJid: normalized, fromMe: false, id: "" },
          0
        );

        // Wait briefly for the history response to arrive via messaging-history.set
        await new Promise((r) => setTimeout(r, 2500));

        // Check live registry again — history may have populated it
        const retryLive = getLiveThreadMessages(userId, normalized, limit);
        if (retryLive.length > 0) {
          return retryLive.map((r) => ({ ...r }));
        }

        // Also check DB — messages may have been stored by the history handler
        const retryRows = await db
          .select({
            id: waChatMessage.id,
            sender: waChatMessage.sender,
            message: waChatMessage.message,
            timestamp: waChatMessage.timestamp,
            mediaKind: waChatMessage.mediaKind,
            waMessagePayload: waChatMessage.waMessagePayload,
          })
          .from(waChatMessage)
          .where(
            and(
              eq(waChatMessage.userId, userId),
              candidateList.length === 1
                ? eq(waChatMessage.chatId, normalized)
                : inArray(waChatMessage.chatId, candidateList)
            )
          )
          .orderBy(asc(waChatMessage.timestamp), asc(waChatMessage.id))
          .limit(limit);

        if (retryRows.length > 0) {
          return retryRows.map((r) => ({
            id: r.id,
            sender: r.sender,
            message: r.message,
            timestamp: new Date(r.timestamp).toISOString(),
            mediaKind: r.mediaKind ?? null,
            hasMediaPayload: Boolean(r.waMessagePayload),
          }));
        }
      } catch {
        // best-effort — socket may be disconnected or API unavailable
      }
    }

    return rows.map((r) => ({
      id: r.id,
      sender: r.sender,
      message: r.message,
      timestamp: new Date(r.timestamp).toISOString(),
      mediaKind: r.mediaKind ?? null,
      hasMediaPayload: Boolean(r.waMessagePayload),
    }));
  } catch (error) {
    if (isMissingRelationError(error)) {
      logMissingRelationOnce("listThreadMessages", error);
      return [];
    }
    if (isUndefinedColumnError(error)) {
      logOptionalWaColumnsOnce("listThreadMessages", String(error));
      const rowsBasic = await db
        .select({
          id: waChatMessage.id,
          sender: waChatMessage.sender,
          message: waChatMessage.message,
          timestamp: waChatMessage.timestamp,
        })
        .from(waChatMessage)
        .where(
          and(
            eq(waChatMessage.userId, userId),
            candidateList.length === 1
              ? eq(waChatMessage.chatId, normalized)
              : inArray(waChatMessage.chatId, candidateList)
          )
        )
        .orderBy(asc(waChatMessage.timestamp), asc(waChatMessage.id))
        .limit(limit);



      return rowsBasic.map((r) => ({
        id: r.id,
        sender: r.sender,
        message: r.message,
        timestamp: new Date(r.timestamp).toISOString(),
        mediaKind: null,
        hasMediaPayload: false,
      }));
    }
    throw error;
  }
}

function guessMimetypeFromProto(message: proto.IMessage | null | undefined): string {
  return (
    message?.imageMessage?.mimetype ||
    message?.videoMessage?.mimetype ||
    message?.audioMessage?.mimetype ||
    message?.stickerMessage?.mimetype ||
    message?.documentMessage?.mimetype ||
    "application/octet-stream"
  );
}

export async function downloadStoredMessageMedia(
  userId: string,
  messageRowId: string
): Promise<{ buffer: Buffer; mimetype: string }> {
  let row: { waMessagePayload: string | null } | undefined;
  try {
    [row] = await db
      .select({ waMessagePayload: waChatMessage.waMessagePayload })
      .from(waChatMessage)
      .where(and(eq(waChatMessage.userId, userId), eq(waChatMessage.id, messageRowId)))
      .limit(1);
  } catch (error) {
    if (isUndefinedColumnError(error)) {
      logOptionalWaColumnsOnce("downloadStoredMessageMedia", String(error));
      throw new ServiceError("Media downloads require database migration (waMessagePayload column).", 503);
    }
    throw error;
  }

  if (!row?.waMessagePayload?.trim()) {
    throw new ServiceError("No media payload for this message", 404);
  }

  let parsed: { key?: proto.IMessageKey | null; message?: proto.IMessage | null };
  try {
    parsed = JSON.parse(row.waMessagePayload, BufferJSON.reviver) as typeof parsed;
  } catch {
    throw new ServiceError("Invalid stored media payload", 400);
  }

  if (!parsed.key || !parsed.message) {
    throw new ServiceError("Incomplete media payload", 400);
  }

  const sock = getSocketFor(userId);
  const stub = { key: parsed.key, message: parsed.message } as proto.IWebMessageInfo;
  const buffer = await downloadMediaMessage(stub as any, "buffer", {}, {
    logger: MEDIA_DOWNLOAD_LOGGER as any,
    reuploadRequest: sock.updateMediaMessage,
  });

  return { buffer: buffer as Buffer, mimetype: guessMimetypeFromProto(parsed.message) };
}
