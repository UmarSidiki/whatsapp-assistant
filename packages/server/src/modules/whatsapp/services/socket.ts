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

// ─── Per-user session state ───────────────────────────────────────────────────

const sessions = new Map<string, WAState>();
const contactNamesByUser = new Map<string, Map<string, string>>();

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

function getOrCreateContactMap(userId: string): Map<string, string> {
  let map = contactNamesByUser.get(userId);
  if (!map) {
    map = new Map<string, string>();
    contactNamesByUser.set(userId, map);
  }
  return map;
}

export function clearContactNamesForUser(userId: string): void {
  contactNamesByUser.delete(userId);
}

export function upsertContactName(userId: string, contactId: string, name: string): void {
  const normalizedId = normalizeContactId(contactId);
  const cleanedName = name.trim();
  if (!normalizedId || !cleanedName) {
    return;
  }
  getOrCreateContactMap(userId).set(normalizedId, cleanedName);
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
  }>
): void {
  for (const contact of contacts) {
    const contactId = contact.id ?? contact.jid;
    const name =
      contact.name?.trim() ||
      contact.notify?.trim() ||
      contact.verifiedName?.trim() ||
      contact.short?.trim() ||
      "";
    if (!contactId || !name) {
      continue;
    }
    upsertContactName(userId, contactId, name);
  }
}

// ─── Backfill Tracking ────────────────────────────────────────────────────────

const backfilledContacts = new Map<string, number>();
const BACKFILL_TTL_MS = 6 * 60 * 60 * 1000;
const BACKFILL_MAX_ENTRIES = 4000;
export const BACKFILL_TARGET_MESSAGES = 500;

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

/**
 * Get contact name from Baileys store by phone number.
 * Returns the contact's saved name, or the phone number if not found/no store available.
 */
export function getContactName(userId: string, contactPhone: string): string {
  try {
    const normalizedPhone = normalizeContactId(contactPhone);
    const cached = contactNamesByUser.get(userId)?.get(normalizedPhone);
    if (cached) {
      return cached;
    }

    const session = getSessionIfExists(userId);
    if (!session?.socket) {
      return contactPhone;
    }

    const sock = session.socket as any;
    const contacts = sock?.store?.contacts as Record<string, any> | undefined;
    if (!contacts) {
      return contactPhone;
    }

    // Try to find the contact by JID format
    const jid = toJid(contactPhone);
    const contact = contacts[jid];
    const directName =
      (typeof contact?.name === "string" && contact.name.trim()) ||
      (typeof contact?.notify === "string" && contact.notify.trim()) ||
      (typeof contact?.verifiedName === "string" && contact.verifiedName.trim()) ||
      (typeof contact?.short === "string" && contact.short.trim()) ||
      "";
    if (directName) {
      upsertContactName(userId, normalizedPhone, directName);
      return directName;
    }

    // Also try without JID format in case it's stored differently
    const contactEntry = Object.entries(contacts).find(
      ([key]) => key.includes(contactPhone) || key.startsWith(contactPhone + "@")
    );
    const maybeContact = contactEntry?.[1] as Record<string, unknown> | undefined;
    const fallbackName =
      (typeof maybeContact?.name === "string" && maybeContact.name.trim()) ||
      (typeof maybeContact?.notify === "string" && maybeContact.notify.trim()) ||
      (typeof maybeContact?.verifiedName === "string" && maybeContact.verifiedName.trim()) ||
      (typeof maybeContact?.short === "string" && maybeContact.short.trim()) ||
      "";
    if (fallbackName) {
      upsertContactName(userId, normalizedPhone, fallbackName);
      return fallbackName;
    }

    return contactPhone;
  } catch {
    return contactPhone;
  }
}
