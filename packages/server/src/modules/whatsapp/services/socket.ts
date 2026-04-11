import {
  type WASocket,
  extractMessageContent,
  isHostedLidUser,
  isHostedPnUser,
  isJidBroadcast,
  isJidStatusBroadcast,
  isLidUser,
  isPnUser,
  jidDecode,
  normalizeMessageContent,
  type proto,
} from "@whiskeysockets/baileys";
import type { WAState, WAStatus } from "../types";
import { ServiceError } from "../types";
import { normalizeChatId } from "./chat-jid";

// ─── Per-user session state ───────────────────────────────────────────────────

const sessions = new Map<string, WAState>();
const contactNamesByUser = new Map<string, Map<string, { name: string; priority: number }>>();

const CONTACT_NAME_PRIORITY = {
  saved: 10,
  verified: 20,
  notify: 30,
  short: 40,
  inferred: 50,
} as const;

type ContactNameSource = keyof typeof CONTACT_NAME_PRIORITY;

function defaultState(): WAState {
  return { socket: null, status: "idle", qr: undefined, lastError: undefined, lastErrorAt: undefined };
}

/** Get the session for a user, creating a default idle session if none exists. */
export function getSession(userId: string): WAState {
  let state = sessions.get(userId);
  if (!state) {
    state = defaultState();
    sessions.set(userId, state);
  }
  return state;
}

/** Read a user's session only if it already exists (no implicit creation). */
export function getSessionIfExists(userId: string): WAState | undefined {
  return sessions.get(userId);
}

/** Merge partial updates into a user's session state. */
export function setSession(userId: string, patch: Partial<WAState>): void {
  const state = getSession(userId);
  Object.assign(state, patch);
}

/** Remove a user's session entirely. */
export function removeSession(userId: string): void {
  sessions.delete(userId);
  contactNamesByUser.delete(userId);
}

function getOrCreateContactMap(userId: string): Map<string, { name: string; priority: number }> {
  let map = contactNamesByUser.get(userId);
  if (!map) {
    map = new Map<string, { name: string; priority: number }>();
    contactNamesByUser.set(userId, map);
  }
  return map;
}

export function clearContactNamesForUser(userId: string): void {
  contactNamesByUser.delete(userId);
}

export function upsertContactName(
  userId: string,
  contactId: string,
  name: string,
  source: ContactNameSource = "notify"
): void {
  const normalizedId = normalizeContactId(contactId);
  const cleanedName = name.trim();
  if (!normalizedId || !cleanedName) {
    return;
  }

  const map = getOrCreateContactMap(userId);
  const existing = map.get(normalizedId);
  const nextPriority = CONTACT_NAME_PRIORITY[source];

  // Keep the best available label per contact (saved > verified > notify > short).
  if (existing && nextPriority > existing.priority) {
    return;
  }

  map.set(normalizedId, { name: cleanedName, priority: nextPriority });
}

export function upsertContactNames(
  userId: string,
  contacts: Array<{
    id?: string;
    jid?: string;
    notify?: string;
    name?: string;
    short?: string;
    verifiedName?: string;
    /** Baileys 7+: address-book phone when contact is identified by LID */
    phoneNumber?: string | null;
    lid?: string | null;
  }>
): void {
  for (const contact of contacts) {
    const contactId = contact.id ?? contact.jid;

    const keys = new Set<string>();
    if (contactId) keys.add(contactId);
    if (contact.phoneNumber?.trim()) keys.add(contact.phoneNumber.trim());
    if (contact.lid?.trim()) keys.add(contact.lid.trim());

    if (keys.size === 0) {
      continue;
    }

    const candidates: Array<{ value: string | undefined; source: ContactNameSource }> = [
      { value: contact.name, source: "saved" },
      { value: contact.verifiedName, source: "verified" },
      { value: contact.notify, source: "notify" },
      { value: contact.short, source: "short" },
    ];

    for (const candidate of candidates) {
      const name = candidate.value?.trim();
      if (!name) continue;
      for (const key of keys) {
        upsertContactName(userId, key, name, candidate.source);
      }
    }
  }
}

// ─── Backfill Tracking ────────────────────────────────────────────────────────

const backfilledContacts = new Map<string, number>();
const BACKFILL_TTL_MS = 6 * 60 * 60 * 1000;
const BACKFILL_MAX_ENTRIES = 4000;
export const BACKFILL_TARGET_MESSAGES = 1000;

export function pruneBackfillTracker(now: number = Date.now()): void {
  backfilledContacts.forEach((requestedAt, key) => {
    if (now - requestedAt > BACKFILL_TTL_MS) {
      backfilledContacts.delete(key);
    }
  });

  if (backfilledContacts.size <= BACKFILL_MAX_ENTRIES) {
    return;
  }

  const sortedByAge: Array<[string, number]> = [];
  backfilledContacts.forEach((requestedAt, key) => {
    sortedByAge.push([key, requestedAt]);
  });
  sortedByAge.sort((a, b) => a[1] - b[1]);

  const overflow = backfilledContacts.size - BACKFILL_MAX_ENTRIES;
  for (let i = 0; i < overflow; i++) {
    const entry = sortedByAge[i];
    if (!entry) break;
    backfilledContacts.delete(entry[0]);
  }
}

export function hasRecentBackfillRequest(backfillKey: string, now: number = Date.now()): boolean {
  const requestedAt = backfilledContacts.get(backfillKey);
  if (!requestedAt) {
    return false;
  }
  if (now - requestedAt > BACKFILL_TTL_MS) {
    backfilledContacts.delete(backfillKey);
    return false;
  }
  return true;
}

export function markBackfillRequested(backfillKey: string): void {
  const now = Date.now();
  backfilledContacts.set(backfillKey, now);
  pruneBackfillTracker(now);
}

export function clearBackfillTrackerForUser(userId: string): void {
  const prefix = `${userId}_`;
  const keysToDelete: string[] = [];
  backfilledContacts.forEach((_, key) => {
    if (key.startsWith(prefix)) {
      keysToDelete.push(key);
    }
  });
  keysToDelete.forEach((key) => backfilledContacts.delete(key));
}

// ─── On-Demand Chat History Tracking ─────────────────────────────────────────

const historySyncRequests = new Map<string, number>();
const HISTORY_SYNC_TTL_MS = 2 * 60 * 1000;
const HISTORY_SYNC_MAX_ENTRIES = 8000;

function toHistorySyncKey(userId: string, chatId: string): string {
  return `${userId}::${normalizeChatId(chatId)}`;
}

function pruneHistorySyncRequests(now: number = Date.now()): void {
  historySyncRequests.forEach((requestedAt, key) => {
    if (now - requestedAt > HISTORY_SYNC_TTL_MS) {
      historySyncRequests.delete(key);
    }
  });

  if (historySyncRequests.size <= HISTORY_SYNC_MAX_ENTRIES) {
    return;
  }

  const sortedByAge: Array<[string, number]> = [];
  historySyncRequests.forEach((requestedAt, key) => {
    sortedByAge.push([key, requestedAt]);
  });
  sortedByAge.sort((a, b) => a[1] - b[1]);

  const overflow = historySyncRequests.size - HISTORY_SYNC_MAX_ENTRIES;
  for (let i = 0; i < overflow; i++) {
    const entry = sortedByAge[i];
    if (!entry) break;
    historySyncRequests.delete(entry[0]);
  }
}

export function markHistorySyncRequested(userId: string, chatId: string): void {
  const normalizedChatId = normalizeChatId(chatId);
  if (!normalizedChatId) return;

  const now = Date.now();
  historySyncRequests.set(toHistorySyncKey(userId, normalizedChatId), now);
  pruneHistorySyncRequests(now);
}

export function markHistorySyncRequestedMany(userId: string, chatIds: string[]): void {
  if (chatIds.length === 0) return;
  for (const chatId of chatIds) {
    markHistorySyncRequested(userId, chatId);
  }
}

export function hasRecentHistorySyncRequest(
  userId: string,
  chatId: string,
  now: number = Date.now()
): boolean {
  const key = toHistorySyncKey(userId, chatId);
  const requestedAt = historySyncRequests.get(key);
  if (!requestedAt) {
    return false;
  }
  if (now - requestedAt > HISTORY_SYNC_TTL_MS) {
    historySyncRequests.delete(key);
    return false;
  }
  return true;
}

export function shouldStoreHistorySyncMessage(userId: string, chatId: string): boolean {
  const normalizedChatId = normalizeChatId(chatId);
  if (!normalizedChatId) {
    return false;
  }
  return hasRecentHistorySyncRequest(userId, normalizedChatId);
}

export function clearHistorySyncRequestsForUser(userId: string): void {
  const prefix = `${userId}::`;
  const keysToDelete: string[] = [];
  historySyncRequests.forEach((_, key) => {
    if (key.startsWith(prefix)) {
      keysToDelete.push(key);
    }
  });
  keysToDelete.forEach((key) => historySyncRequests.delete(key));
}


/** Throw a ServiceError if the user's WhatsApp session is not connected. */
export function requireConnectedFor(userId: string): void {
  const { socket, status } = getSession(userId);
  if (!socket || status !== "connected") {
    throw new ServiceError("WhatsApp is not connected", 400);
  }
}

/** Return the user's connected socket or throw. */
export function getSocketFor(userId: string): WASocket {
  requireConnectedFor(userId);
  return getSession(userId).socket!;
}

/** Return the full sessions map (e.g. for auto-reconnect on startup). */
export function getAllSessions(): Map<string, WAState> {
  return sessions;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Convert a phone number to a WhatsApp JID (e.g. "15551234567@s.whatsapp.net"). */
export const toJid = (phone: string) =>
  phone.replace(/\D/g, "") + "@s.whatsapp.net";

/** Phone digits or full JID (group / channel / LID) for outgoing sends. */
export function resolveOutgoingJid(target: string): string {
  const trimmed = target.trim();
  if (!trimmed) return "";
  const lower = trimmed.toLowerCase();
  if (lower.includes("@")) return lower;
  return toJid(trimmed);
}

/** Returns true only for individual contacts (PN/LID), not groups/status/broadcast. */
export const isIndividualJid = (jid: string) =>
  !isJidStatusBroadcast(jid) &&
  !isJidBroadcast(jid) &&
  Boolean(isPnUser(jid) || isLidUser(jid) || isHostedPnUser(jid) || isHostedLidUser(jid));

/** Extract stable contact identifier from any user JID (PN/LID/hosted). */
export function jidToContactId(jid: string): string {
  const user = jidDecode(jid)?.user;
  if (user) return normalizeContactId(user);
  return normalizeContactId(jid.split("@")[0] ?? jid);
}

/** Normalize contact identifiers from phone numbers, JIDs, PN, or LID values. */
export function normalizeContactId(contactId: string): string {
  const trimmed = contactId.trim();
  if (!trimmed) return "";

  const decodedUser = jidDecode(trimmed)?.user;
  if (decodedUser) {
    return decodedUser.toLowerCase();
  }

  const rawUser = trimmed.includes("@") ? (trimmed.split("@")[0] ?? "") : trimmed;
  const digitsOnly = rawUser.replace(/\D/g, "");
  return (digitsOnly || rawUser).toLowerCase();
}

export function formatContactRefForDisplay(contactRef: string): string {
  const trimmed = contactRef.trim();
  if (!trimmed) return "";

  const decoded = jidDecode(trimmed);
  const server = decoded?.server?.toLowerCase() ?? "";
  const user = (decoded?.user ?? (trimmed.includes("@") ? (trimmed.split("@")[0] ?? "") : trimmed)).trim();
  if (!user) return trimmed;

  const digits = user.replace(/\D/g, "");
  const isPhoneJid = server === "s.whatsapp.net" || server === "c.us";
  const isRawPhone = !server && /^\+?\d{6,}$/.test(trimmed);

  if ((isPhoneJid || isRawPhone) && digits) {
    return `+${digits}`;
  }

  return normalizeContactId(trimmed) || user || trimmed;
}

/** Extract text from common WhatsApp message payload variants (incl. wrapped messages). */
export function extractTextFromMessage(message?: proto.IMessage | null): string {
  const content = extractMessageContent(message) ?? normalizeMessageContent(message);
  if (!content) return "";
  return (
    content.conversation ||
    content.extendedTextMessage?.text ||
    content.imageMessage?.caption ||
    content.videoMessage?.caption ||
    content.documentMessage?.caption ||
    content.buttonsResponseMessage?.selectedDisplayText ||
    content.listResponseMessage?.title ||
    content.templateButtonReplyMessage?.selectedDisplayText ||
    (content as any).interactiveResponseMessage?.body?.text ||
    ""
  ).trim();
}

/** Read contextInfo from common message containers after normalizing wrappers. */
export function getContextInfoFromMessage(
  message?: proto.IMessage | null
): proto.IContextInfo | undefined {
  const content = extractMessageContent(message) ?? normalizeMessageContent(message);
  return (
    content?.extendedTextMessage?.contextInfo ||
    content?.imageMessage?.contextInfo ||
    content?.videoMessage?.contextInfo ||
    content?.documentMessage?.contextInfo ||
    undefined
  );
}

/**
 * Resolve a JID to a phone number string.
 * For PN JIDs (e.g. 923001234567@s.whatsapp.net), extracts the phone directly.
 * For LID JIDs, attempts to resolve via the socket's signal repository mapping.
 * Returns the numeric phone or the raw contactId if resolution fails.
 */
export async function resolvePhoneNumber(userId: string, jid: string): Promise<string> {
  // If it's a phone-based JID, just extract the number
  if (isPnUser(jid) || isHostedPnUser(jid)) {
    return jidToContactId(jid);
  }

  // For LID JIDs, try to resolve via Baileys' internal LID mapping
  if (isLidUser(jid) || isHostedLidUser(jid)) {
    try {
      const session = getSessionIfExists(userId);
      const sock = session?.socket as any;
      const pnJid = await sock?.signalRepository?.lidMapping?.getPNForLID(jid);
      if (pnJid && typeof pnJid === "string") {
        const decoded = jidDecode(pnJid);
        if (decoded?.user) return decoded.user;
      }
    } catch {
      // Fall through to default
    }
  }

  return jidToContactId(jid);
}

function readContactRecordName(
  contact: Record<string, unknown> | undefined
): { name: string; source: ContactNameSource } | null {
  if (!contact) return null;

  const saved = typeof contact.name === "string" ? contact.name.trim() : "";
  if (saved) return { name: saved, source: "saved" };

  const verified = typeof contact.verifiedName === "string" ? contact.verifiedName.trim() : "";
  if (verified) return { name: verified, source: "verified" };

  const notify = typeof contact.notify === "string" ? contact.notify.trim() : "";
  if (notify) return { name: notify, source: "notify" };

  const short = typeof contact.short === "string" ? contact.short.trim() : "";
  if (short) return { name: short, source: "short" };

  return null;
}

/**
 * Resolve saved / push name for a contact. `contactRef` may be digits, full PN JID, or `@lid` JID (Baileys 7).
 */
export function getContactName(userId: string, contactRef: string): string {
  try {
    const normalizedKey = normalizeContactId(contactRef);
    const fallbackName = formatContactRefForDisplay(contactRef) || normalizedKey || contactRef;
    const cached = contactNamesByUser.get(userId)?.get(normalizedKey);
    if (cached?.name) {
      return cached.name;
    }

    const session = getSessionIfExists(userId);
    if (!session?.socket) {
      return fallbackName;
    }

    const contacts = (session.store?.contacts ?? (session.socket as any)?.store?.contacts) as Record<string, any> | undefined;
    if (!contacts) {
      return fallbackName;
    }

    const tryKeys: string[] = [];
    const trimmed = contactRef.trim().toLowerCase();
    if (trimmed.includes("@")) {
      tryKeys.push(trimmed);
    }
    if (normalizedKey) {
      tryKeys.push(`${normalizedKey}@lid`);
      tryKeys.push(`${normalizedKey}@s.whatsapp.net`);
      if (/^\d+$/.test(normalizedKey)) {
        tryKeys.push(toJid(normalizedKey));
      }
    }

    for (const key of tryKeys) {
      const candidate = readContactRecordName(contacts[key]);
      if (candidate) {
        upsertContactName(userId, normalizedKey || contactRef, candidate.name, candidate.source);
        return candidate.name;
      }
    }

    for (const [key, c] of Object.entries(contacts)) {
      try {
        if (normalizeContactId(jidToContactId(key)) === normalizedKey) {
          const candidate = readContactRecordName(c as Record<string, unknown>);
          if (candidate) {
            upsertContactName(userId, normalizedKey || contactRef, candidate.name, candidate.source);
            return candidate.name;
          }
        }
      } catch {
        continue;
      }
    }

    const contactEntry = Object.entries(contacts).find(
      ([key]) => key.includes(contactRef) || key.startsWith(normalizedKey + "@")
    );
    const fallbackCandidate = readContactRecordName(contactEntry?.[1] as Record<string, unknown>);
    if (fallbackCandidate) {
      upsertContactName(userId, normalizedKey || contactRef, fallbackCandidate.name, fallbackCandidate.source);
      return fallbackCandidate.name;
    }

    return fallbackName;
  } catch {
    return formatContactRefForDisplay(contactRef) || contactRef;
  }
}

export function listKnownContacts(userId: string): Array<{ contactId: string; name: string }> {
  const out = new Map<string, string>();

  const cached = contactNamesByUser.get(userId);
  if (cached) {
    for (const [contactId, entry] of cached.entries()) {
      const normalized = normalizeContactId(contactId);
      const cleaned = entry.name.trim();
      if (normalized && cleaned) {
        out.set(normalized, cleaned);
      }
    }
  }

  const session = getSessionIfExists(userId);
  const contacts = (session?.store?.contacts ?? (session?.socket as any)?.store?.contacts) as Record<string, unknown> | undefined;
  if (contacts) {
    for (const [key, value] of Object.entries(contacts)) {
      const record = (value && typeof value === "object" ? (value as Record<string, unknown>) : undefined) ?? {};
      const candidate = readContactRecordName(record);
      if (!candidate?.name) continue;
      const contactId = normalizeContactId(jidToContactId(key));
      if (!contactId) continue;
      if (!out.has(contactId)) {
        out.set(contactId, candidate.name);
      }
    }
    for (const key of Object.keys(contacts)) {
      const contactId = normalizeContactId(jidToContactId(key));
      if (!contactId) continue;
      if (!out.has(contactId)) {
        out.set(contactId, formatContactRefForDisplay(contactId) || contactId);
      }
    }
  }

  return [...out.entries()].map(([contactId, name]) => ({ contactId, name }));
}
