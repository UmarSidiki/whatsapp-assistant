import makeWASocket, {
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
} from "@whiskeysockets/baileys";
import pino from "pino";
import { existsSync, readdirSync } from "fs";
import { logger } from "../lib/logger";
import {
  getSession,
  setSession,
  removeSession,
  isIndividualJid,
} from "./wa-socket";
import { handleAutoReply } from "./autoreply.service";
import { storeMessage } from "./ai-assistant.service";
import { bufferIncomingMessage } from "./segment.service";

// ─── Per-user auth directory ──────────────────────────────────────────────────

const WA_AUTH_ROOT = "./wa-auth";

function authDir(userId: string): string {
  return `${WA_AUTH_ROOT}/${userId}`;
}

// ─── Connection ───────────────────────────────────────────────────────────────

/** Initialize the WhatsApp socket for a specific user. */
export async function init(userId: string): Promise<void> {
  const session = getSession(userId);
  if (session.socket && (session.status === "waiting_qr" || session.status === "connected")) {
    return; // already active
  }

  logger.info("WhatsApp initializing", { userId });

  const { state, saveCreds } = await useMultiFileAuthState(authDir(userId));
  const { version } = await fetchLatestBaileysVersion();
  setSession(userId, { status: "waiting_qr", qr: undefined });

  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    logger: pino({ level: "silent" }) as any,
    syncFullHistory: false,
    markOnlineOnConnect: false,
    browser: ["Ubuntu", "Chrome", "110.0.5481.77"],
  });
  setSession(userId, { socket: sock });

  sock.ev.on("connection.update", ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      setSession(userId, { qr, status: "waiting_qr" });
      logger.info("QR code generated", { userId });
    }
    if (connection === "open") {
      setSession(userId, { status: "connected", qr: undefined });
      logger.info("WhatsApp connected", { userId });
    }
    if (connection === "close") {
      const code = (lastDisconnect?.error as { output?: { statusCode?: number } })
        ?.output?.statusCode;
      const loggedOut = code === DisconnectReason.loggedOut;
      setSession(userId, {
        status: loggedOut ? "disconnected" : "waiting_qr",
        socket: null,
        qr: loggedOut ? undefined : getSession(userId).qr,
      });
      logger.info("WhatsApp connection closed", { userId, code, loggedOut });
      // Auto-reconnect unless explicitly logged out
      if (!loggedOut) {
        setTimeout(() => init(userId).catch(() => {}), 3000);
      }
    }
  });

  // Route incoming messages to handlers (individual contacts only)
  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;
    for (const msg of messages) {
      const jid = msg.key.remoteJid ?? "";
      if (!isIndividualJid(jid)) continue;

      const text =
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        "";
      if (!text) continue;

      const contactPhone = jid.replace("@s.whatsapp.net", "");
      const sender = msg.key.fromMe ? "me" : "contact";

      // Store message in AI chat history
      storeMessage(userId, contactPhone, text, sender).catch(() => {});

      // Handle auto-reply and AI for incoming messages (not from self)
      if (!msg.key.fromMe) {
        // Buffer rapid incoming messages before processing
        const bufferKey = `${userId}_${contactPhone}`;
        bufferIncomingMessage(bufferKey, text, async (combinedText) => {
          await handleAutoReply(userId, jid, combinedText);
        });
      }
    }
  });

  sock.ev.on("creds.update", saveCreds);
}

/** Disconnect a user's WhatsApp and reset state to idle. */
export async function disconnect(userId: string): Promise<void> {
  const session = getSession(userId);
  if (session.socket) {
    try { await session.socket.logout(); } catch { session.socket?.end(undefined); }
  }
  removeSession(userId);
  logger.info("WhatsApp disconnected", { userId });
}

/** Return connection status and QR code for a specific user. */
export function getStatus(userId: string) {
  const session = getSession(userId);
  return { status: session.status, qr: session.qr };
}

// ─── Auto-reconnect on server boot ────────────────────────────────────────────

/**
 * Scan wa-auth directories and auto-connect users who have stored credentials.
 * Called once on server startup.
 */
export async function autoReconnectAll(): Promise<void> {
  if (!existsSync(WA_AUTH_ROOT)) return;

  const entries = readdirSync(WA_AUTH_ROOT, { withFileTypes: true });
  const userDirs = entries.filter(
    (e) => e.isDirectory() && existsSync(`${WA_AUTH_ROOT}/${e.name}/creds.json`)
  );

  logger.info(`Auto-reconnecting ${userDirs.length} WhatsApp session(s)`);

  for (const dir of userDirs) {
    const userId = dir.name;
    try {
      await init(userId);
      logger.info("Auto-reconnected WhatsApp", { userId });
    } catch (e) {
      logger.error("Failed to auto-reconnect WhatsApp", { userId, error: String(e) });
    }
  }
}
