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

// ─── Types ────────────────────────────────────────────────────────────────────

export type WAStatus = "idle" | "waiting_qr" | "connected" | "disconnected";

export interface WAState {
  socket: WASocket | null;
  status: WAStatus;
  qr: string | undefined;
}

/** Business-logic error that carries an HTTP status code. */
export class ServiceError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number = 400,
  ) {
    super(message);
    this.name = "ServiceError";
  }
}

// ─── Per-user session state ───────────────────────────────────────────────────

const sessions = new Map<string, WAState>();

function defaultState(): WAState {
  return { socket: null, status: "idle", qr: undefined };
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
