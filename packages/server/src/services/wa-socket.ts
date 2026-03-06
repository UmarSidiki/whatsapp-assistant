import type { WASocket } from "@whiskeysockets/baileys";

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

/** Returns true only for individual contacts — not groups, status, or broadcasts. */
export const isIndividualJid = (jid: string) =>
  jid.endsWith("@s.whatsapp.net") &&
  !jid.startsWith("status@") &&
  !jid.startsWith("broadcast@");
