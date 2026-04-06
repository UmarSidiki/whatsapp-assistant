import type { WASocket } from "@whiskeysockets/baileys";

/**
 * WhatsApp connection status
 */
export type WAStatus = "idle" | "waiting_qr" | "connected" | "disconnected";

/**
 * WhatsApp session state for a user
 */
export interface WAState {
  socket: WASocket | null;
  status: WAStatus;
  qr: string | undefined;
  lastError?: string;
  lastErrorAt?: string;
}

/**
 * Business-logic error that carries an HTTP status code
 */
export class ServiceError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number = 400,
  ) {
    super(message);
    this.name = "ServiceError";
  }
}
