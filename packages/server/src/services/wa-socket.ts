import type { WASocket } from "@whiskeysockets/baileys";

// ─── Types ────────────────────────────────────────────────────────────────────

export type WAStatus = "idle" | "waiting_qr" | "connected" | "disconnected";

/** Business-logic error that carries an HTTP status code. */
export class ServiceError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number = 400
  ) {
    super(message);
    this.name = "ServiceError";
  }
}

// ─── Shared socket state ──────────────────────────────────────────────────────

/**
 * Single shared WhatsApp socket state.
 * All feature services read and write from this object.
 */
export const wa = {
  socket: null as WASocket | null,
  status: "idle" as WAStatus,
  qr: undefined as string | undefined,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Throws a ServiceError if WhatsApp is not connected. */
export function requireConnected(): void {
  if (!wa.socket || wa.status !== "connected") {
    throw new ServiceError("WhatsApp is not connected", 400);
  }
}

/** Convert a phone number to a WhatsApp JID (e.g. "15551234567@s.whatsapp.net"). */
export const toJid = (phone: string) =>
  phone.replace(/\D/g, "") + "@s.whatsapp.net";

/** Returns true only for individual contacts — not groups, status, or broadcasts. */
export const isIndividualJid = (jid: string) =>
  jid.endsWith("@s.whatsapp.net") &&
  !jid.startsWith("status@") &&
  !jid.startsWith("broadcast@");
