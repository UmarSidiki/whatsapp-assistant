import type { DashboardChat, DashboardChatScope } from "../types/dashboard-chat";
import { normalizeChatId, resolveChatTypeFromJid, type ChatType } from "./chat-jid";
import { getContactName, jidToContactId, normalizeContactId } from "./socket";

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

function getScopeTypes(scope: DashboardChatScope): ChatType[] {
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

const liveChatsByUser = new Map<string, Map<string, DashboardChat>>();
const liveMessagesByUser = new Map<string, Map<string, LiveThreadMessage[]>>();
const MAX_LIVE_MESSAGES_PER_CHAT = 800;

export interface LiveThreadMessage {
  id: string;
  sender: "me" | "contact";
  message: string;
  timestamp: string;
  mediaKind: string | null;
  hasMediaPayload: boolean;
}

export function clearLiveChatsForUser(userId: string): void {
  liveChatsByUser.delete(userId);
  liveMessagesByUser.delete(userId);
}

function ensureUserMap(userId: string): Map<string, DashboardChat> {
  let map = liveChatsByUser.get(userId);
  if (!map) {
    map = new Map();
    liveChatsByUser.set(userId, map);
  }
  return map;
}

function ensureUserMessages(userId: string): Map<string, LiveThreadMessage[]> {
  let map = liveMessagesByUser.get(userId);
  if (!map) {
    map = new Map();
    liveMessagesByUser.set(userId, map);
  }
  return map;
}

function recordToDashboard(userId: string, rawId: string, chat: Record<string, unknown>): DashboardChat | null {
  const chatId = normalizeChatId(getNonEmptyString(chat.id, chat.jid, rawId) ?? "");
  const chatType = resolveChatTypeFromJid(chatId);
  if (!chatType) return null;

  const messageRecord = asRecord(chat.lastMessage);
  const lastMessageText = getNonEmptyString(
    (messageRecord?.message as { conversation?: string })?.conversation,
    chat.lastMessageText,
    chat.lastMsg,
    chat.conversation
  );
  const lastMessage = lastMessageText
    ? lastMessageText.length > 160
      ? `${lastMessageText.slice(0, 157)}...`
      : lastMessageText
    : undefined;

  const epochMs =
    toEpochMs(chat.conversationTimestamp) ??
    toEpochMs(chat.lastMessageRecvTimestamp) ??
    toEpochMs(chat.lastMessageTimestamp) ??
    toEpochMs(chat.timestamp) ??
    toEpochMs(messageRecord?.messageTimestamp) ??
    toEpochMs(messageRecord?.timestamp);
  const lastMessageAt = epochMs ? new Date(epochMs).toISOString() : undefined;

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
      lastMessage,
      lastMessageAt,
      unreadCount: Math.max(0, Math.floor(toNumber(chat.unreadCount ?? chat.unreadCounter))),
      isPinned: Boolean(toNumber(chat.pin) > 0 || chat.pinned),
      isArchived: Boolean(chat.archive ?? chat.archived),
      messageCount: 0,
    };
  }

  return {
    id: chatId,
    title: getNonEmptyString(chat.name, chat.subject, chat.notify, chat.formattedTitle) || chatId,
    type: chatType,
    target: chatId,
    lastMessage,
    lastMessageAt,
    unreadCount: Math.max(0, Math.floor(toNumber(chat.unreadCount ?? chat.unreadCounter))),
    isPinned: Boolean(toNumber(chat.pin) > 0 || chat.pinned),
    isArchived: Boolean(chat.archive ?? chat.archived),
    messageCount: 0,
  };
}

export function ingestChatsUpsert(userId: string, chats: unknown): void {
  if (!Array.isArray(chats) || chats.length === 0) return;
  const map = ensureUserMap(userId);
  for (const item of chats) {
    const rec = asRecord(item);
    if (!rec) continue;
    const id = getNonEmptyString(rec.id, rec.jid) ?? "";
    const row = recordToDashboard(userId, id, rec);
    if (row) map.set(normalizeChatId(row.id), row);
  }
}

export function ingestChatsUpdate(userId: string, updates: unknown): void {
  if (!Array.isArray(updates) || updates.length === 0) return;
  const map = ensureUserMap(userId);
  for (const item of updates) {
    const rec = asRecord(item);
    if (!rec) continue;
    const id = getNonEmptyString(rec.id, rec.jid);
    if (!id) continue;
    const key = normalizeChatId(id);
    const existing = map.get(key);
    if (existing) {
      const u = toNumber(rec.unreadCount ?? rec.unreadCounter);
      const epochMs =
        toEpochMs(rec.conversationTimestamp) ??
        toEpochMs(rec.lastMessageRecvTimestamp) ??
        toEpochMs(rec.lastMessageTimestamp);
      map.set(key, {
        ...existing,
        unreadCount: Number.isFinite(u) ? Math.max(0, Math.floor(u)) : existing.unreadCount,
        isPinned:
          rec.pinned !== undefined ? Boolean(rec.pinned) : rec.pin !== undefined ? toNumber(rec.pin) > 0 : existing.isPinned,
        isArchived: rec.archive !== undefined ? Boolean(rec.archive) : rec.archived !== undefined ? Boolean(rec.archived) : existing.isArchived,
        lastMessageAt: epochMs ? new Date(epochMs).toISOString() : existing.lastMessageAt,
        title: getNonEmptyString(rec.name, rec.subject, rec.notify) || existing.title,
      });
    } else {
      const row = recordToDashboard(userId, id, rec);
      if (row) map.set(key, row);
    }
  }
}

export function ingestChatsDelete(userId: string, ids: unknown): void {
  if (!Array.isArray(ids) || ids.length === 0) return;
  const map = liveChatsByUser.get(userId);
  if (!map) return;
  for (const raw of ids) {
    const rec = typeof raw === "string" ? null : asRecord(raw);
    const id = typeof raw === "string" ? raw : getNonEmptyString(rec?.id, rec?.jid) ?? "";
    if (id) {
      const key = normalizeChatId(id);
      map.delete(key);
      liveMessagesByUser.get(userId)?.delete(key);
    }
  }
}

export function touchChatFromMessage(
  userId: string,
  jid: string,
  params: { lastMessage?: string; lastMessageAt?: string; title?: string }
): void {
  const chatId = normalizeChatId(jid);
  const chatType = resolveChatTypeFromJid(chatId);
  if (!chatType) return;

  const map = ensureUserMap(userId);
  const existing = map.get(chatId);
  const contactId = chatType === "direct" ? normalizeContactId(jidToContactId(chatId)) : "";
  const base: DashboardChat =
    existing ??
    (chatType === "direct"
      ? {
          id: chatId,
          title:
            params.title?.trim() ||
            getContactName(userId, chatId) ||
            contactId ||
            chatId,
          type: "direct",
          target: contactId || chatId,
          contactId: contactId || undefined,
          lastMessage: undefined,
          lastMessageAt: undefined,
          unreadCount: 0,
          isPinned: false,
          isArchived: false,
          messageCount: 0,
        }
      : {
          id: chatId,
          title: params.title?.trim() || chatId,
          type: chatType,
          target: chatId,
          lastMessage: undefined,
          lastMessageAt: undefined,
          unreadCount: 0,
          isPinned: false,
          isArchived: false,
          messageCount: 0,
        });

  const nextLastAt = params.lastMessageAt;
  const prevAt = base.lastMessageAt ? Date.parse(base.lastMessageAt) : 0;
  const nextAt = nextLastAt ? Date.parse(nextLastAt) : 0;
  const useNew = !existing || nextAt >= prevAt;

  const nextTitle =
    chatType === "direct"
      ? params.title?.trim() && !params.title.includes("@")
        ? params.title.trim()
        : getContactName(userId, chatId) || base.title
      : params.title?.trim() || base.title;

  map.set(chatId, {
    ...base,
    title: nextTitle,
    lastMessage: useNew ? params.lastMessage ?? base.lastMessage : base.lastMessage,
    lastMessageAt: useNew ? params.lastMessageAt ?? base.lastMessageAt : base.lastMessageAt,
  });
}

export function appendLiveThreadMessage(
  userId: string,
  jid: string,
  input: {
    id: string;
    sender: "me" | "contact";
    message: string;
    timestamp: string;
    mediaKind?: string | null;
    hasMediaPayload?: boolean;
  }
): void {
  const chatId = normalizeChatId(jid);
  if (!chatId) return;

  const messagesByChat = ensureUserMessages(userId);
  const existing = messagesByChat.get(chatId) ?? [];
  const next: LiveThreadMessage = {
    id: input.id,
    sender: input.sender,
    message: input.message,
    timestamp: input.timestamp,
    mediaKind: input.mediaKind ?? null,
    hasMediaPayload: Boolean(input.hasMediaPayload),
  };
  if (existing.some((row) => row.id === next.id)) return;
  existing.push(next);
  existing.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  if (existing.length > MAX_LIVE_MESSAGES_PER_CHAT) {
    existing.splice(0, existing.length - MAX_LIVE_MESSAGES_PER_CHAT);
  }
  messagesByChat.set(chatId, existing);
}

export function getLiveThreadMessages(userId: string, chatId: string, limit = 150): LiveThreadMessage[] {
  const normalized = normalizeChatId(chatId);
  const rows = liveMessagesByUser.get(userId)?.get(normalized) ?? [];
  if (rows.length <= limit) return rows;
  return rows.slice(rows.length - limit);
}

export function getLiveDashboardChats(userId: string, scope: DashboardChatScope): DashboardChat[] {
  const map = liveChatsByUser.get(userId);
  if (!map) return [];
  const allowed = new Set(getScopeTypes(scope));
  const rows = [...map.values()].filter((c) => allowed.has(c.type as ChatType));
  return rows.sort((a, b) => {
    const aTs = a.lastMessageAt ? Date.parse(a.lastMessageAt) : 0;
    const bTs = b.lastMessageAt ? Date.parse(b.lastMessageAt) : 0;
    if (aTs !== bTs) return bTs - aTs;
    return a.title.localeCompare(b.title);
  });
}
