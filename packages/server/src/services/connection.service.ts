import makeWASocket, {
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
} from "@whiskeysockets/baileys";
import pino from "pino";
import { logger } from "../lib/logger";
import { wa, isIndividualJid } from "./wa-socket";
import { handleAutoReply } from "./autoreply.service";

// ─── Connection ───────────────────────────────────────────────────────────────

/** Initialize the WhatsApp socket and start listening for events. */
export async function init(): Promise<void> {
  if (wa.socket && (wa.status === "waiting_qr" || wa.status === "connected")) {
    return; // already active
  }

  logger.info("WhatsApp initializing");

  const { state, saveCreds } = await useMultiFileAuthState("./wa-auth");
  const { version } = await fetchLatestBaileysVersion();
  wa.status = "waiting_qr";
  wa.qr = undefined;

  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    logger: pino({ level: "silent" }) as any,
    syncFullHistory: false,
    markOnlineOnConnect: false,
    browser: ["Ubuntu", "Chrome", "110.0.5481.77"],
  });
  wa.socket = sock;

  sock.ev.on("connection.update", ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      wa.qr = qr;
      wa.status = "waiting_qr";
      logger.info("QR code generated");
    }
    if (connection === "open") {
      wa.status = "connected";
      wa.qr = undefined;
      logger.info("WhatsApp connected");
    }
    if (connection === "close") {
      const code = (lastDisconnect?.error as { output?: { statusCode?: number } })
        ?.output?.statusCode;
      const loggedOut = code === DisconnectReason.loggedOut;
      wa.status = loggedOut ? "disconnected" : "waiting_qr";
      wa.socket = null;
      if (loggedOut) wa.qr = undefined;
      logger.info("WhatsApp connection closed", { code, loggedOut });
      // Auto-reconnect unless explicitly logged out
      if (!loggedOut) init().catch(() => {});
    }
  });

  // Route incoming messages to the auto-reply handler (individual contacts only)
  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;
    for (const msg of messages) {
      if (msg.key.fromMe) continue;
      const jid = msg.key.remoteJid ?? "";
      if (!isIndividualJid(jid)) continue;
      const text =
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        "";
      if (text) await handleAutoReply(jid, text);
    }
  });

  sock.ev.on("creds.update", saveCreds);
}

/** Disconnect and reset state to idle. */
export async function disconnect(): Promise<void> {
  if (wa.socket) {
    try { await wa.socket.logout(); } catch { wa.socket?.end(undefined); }
    wa.socket = null;
  }
  wa.status = "idle";
  wa.qr = undefined;
  logger.info("WhatsApp disconnected");
}

/** Return current connection status and QR code (if in waiting_qr state). */
export function getStatus() {
  return { status: wa.status, qr: wa.qr };
}
