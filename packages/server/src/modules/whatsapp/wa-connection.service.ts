import { handleOwnCommand, handleAIResponse, OwnCommandContext } from "../messaging/incoming-message.service";
import { executeFlows } from "../flow/flow.service";
import makeWASocket, {
  downloadMediaMessage,
  extractMessageContent,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
  normalizeMessageContent,
  type proto,
  type WASocket,
} from "@whiskeysockets/baileys";
import pino from "pino";
import { existsSync, readdirSync, rmSync } from "fs";
import { eq } from "drizzle-orm";
import { logger } from "../../core/logger";
import { getSession, getSessionIfExists, setSession, removeSession, extractTextFromMessage, getContextInfoFromMessage, isIndividualJid, jidToContactId, getSocketFor, toJid, clearBackfillTrackerForUser, clearContactNamesForUser, upsertContactName, upsertContactNames } from "./wa-socket";
import { handleAutoReply } from "../auto-reply/autoreply.service";
import {
  storeMessage,
  trimMessageHistoryForContact,
  getMessageCount,
  getMessageHistory,
} from "../ai/ai-assistant.service";
import {
  parseCommand,
  executeCommand,
  isMimicEnabledForContact,
  clearMimicSettingsForUser,
  type CommandResult,
} from "../messaging/message-handler.service";
import { generateResponse, generatePersonaAIDescription } from "../ai/ai-response.service";
import { getPersona, extractPersona, savePersona } from "../ai/ai-persona.service";
import {
  bufferIncomingMessage,
  sendSegmented,
  sendSegments,
  clearBufferedMessagesForUser,
} from "../messaging/segment.service";
import { addScheduledMessage, restoreScheduledMessagesForUser } from "../scheduling/schedule.service";
import { db } from "../../database";
import { aiSettings, messageLog } from "../../database/schema";

// ─── Per-user auth directory ──────────────────────────────────────────────────

const WA_AUTH_ROOT = "./wa-auth";

function authDir(userId: string): string {
  return `${WA_AUTH_ROOT}/${userId}`;
}

const reconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();
const inFlightInits = new Set<string>();
const explicitDisconnects = new Set<string>();

function isCurrentSocket(userId: string, socket: WASocket): boolean {
  return getSessionIfExists(userId)?.socket === socket;
}

function destroySocket(userId: string, socket: WASocket): void {
  try {
    socket.ev.removeAllListeners("connection.update");
    socket.ev.removeAllListeners("messages.upsert");
    socket.ev.removeAllListeners("creds.update");
    socket.ev.removeAllListeners("messaging-history.set" as any);
  } catch (error) {
    logger.warn("Failed to remove WhatsApp socket listeners", { userId, error: String(error) });
  }

  try {
    socket.end(undefined);
  } catch (error) {
    logger.warn("Failed to end WhatsApp socket", { userId, error: String(error) });
  }
}

function clearReconnectTimer(userId: string): void {
  const timer = reconnectTimers.get(userId);
  if (!timer) return;
  clearTimeout(timer);
  reconnectTimers.delete(userId);
}

function scheduleReconnect(userId: string, delayMs: number = 3000): void {
  clearReconnectTimer(userId);
  const timer = setTimeout(() => {
    reconnectTimers.delete(userId);
    init(userId).catch((error) => {
      logger.warn("WhatsApp reconnect attempt failed", { userId, error: String(error) });
    });
  }, delayMs);
  timer.unref?.();
  reconnectTimers.set(userId, timer);
}



function clearAuthState(userId: string): void {
  const dir = authDir(userId);
  if (!existsSync(dir)) return;
  rmSync(dir, { recursive: true, force: true });
  logger.info("WhatsApp auth directory cleared", { userId });
}

function clearRuntimeState(userId: string): void {
  clearBackfillTrackerForUser(userId);
  clearMimicSettingsForUser(userId);
  clearBufferedMessagesForUser(userId);
  clearContactNamesForUser(userId);
}

// ─── Connection ───────────────────────────────────────────────────────────────

/** Initialize the WhatsApp socket for a specific user. */
export async function init(userId: string): Promise<void> {
  const session = getSession(userId);
  if (session.socket && (session.status === "waiting_qr" || session.status === "connected")) {
    return; // already active
  }
  if (inFlightInits.has(userId)) {
    logger.info("WhatsApp init already in progress", { userId });
    return;
  }

  inFlightInits.add(userId);
  explicitDisconnects.delete(userId);
  clearReconnectTimer(userId);

  try {
    if (session.socket) {
      logger.warn("Cleaning stale WhatsApp socket before init", {
        userId,
        status: session.status,
      });
      destroySocket(userId, session.socket);
      setSession(userId, { socket: null, status: "idle", qr: undefined });
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
      syncFullHistory: true,
      markOnlineOnConnect: false,
      browser: ["Ubuntu", "Chrome", "110.0.5481.77"],
    });

    setSession(userId, { socket: sock });

    sock.ev.on("contacts.upsert" as any, (contacts: any[]) => {
      if (!isCurrentSocket(userId, sock) || !Array.isArray(contacts)) return;
      upsertContactNames(userId, contacts as any);
    });

    sock.ev.on("contacts.update" as any, (contacts: any[]) => {
      if (!isCurrentSocket(userId, sock) || !Array.isArray(contacts)) return;
      upsertContactNames(userId, contacts as any);
    });

    sock.ev.on("connection.update", ({ connection, lastDisconnect, qr }) => {
      if (!isCurrentSocket(userId, sock)) return;

      if (qr) {
        clearReconnectTimer(userId);
        setSession(userId, { qr, status: "waiting_qr" });
        logger.info("QR code generated", { userId });
      }
      if (connection === "open") {
        clearReconnectTimer(userId);
        setSession(userId, { status: "connected", qr: undefined });
        logger.info("WhatsApp connected", { userId });
        
        // Restore pending scheduled messages for this active socket
        restoreScheduledMessagesForUser(userId).catch(error => {
          logger.error("Failed to restore scheduled messages for user", { userId, error: String(error) });
        });
      }
      if (connection === "close") {
        clearReconnectTimer(userId);
        const code = (lastDisconnect?.error as { output?: { statusCode?: number } })
          ?.output?.statusCode;
        const requestedByUser = explicitDisconnects.has(userId);
        const loggedOut = code === DisconnectReason.loggedOut || requestedByUser;
        const currentQr = getSessionIfExists(userId)?.qr;

        setSession(userId, {
          status: loggedOut ? "disconnected" : "waiting_qr",
          socket: null,
          qr: loggedOut ? undefined : currentQr,
        });

        if (loggedOut) {
          if (!requestedByUser) {
            try {
              clearAuthState(userId);
            } catch (error) {
              logger.warn("Failed to clear auth after logout", { userId, error: String(error) });
            }
          }
          clearRuntimeState(userId);
        }

        destroySocket(userId, sock);
        logger.info("WhatsApp connection closed", { userId, code, loggedOut, requestedByUser });

        // Auto-reconnect unless explicitly logged out/disconnected
        if (!loggedOut) {
          scheduleReconnect(userId);
        }
      }
    });

    // ── Store bulk history from initial sync ─────────────────────────────────
    sock.ev.on("messaging-history.set" as any, async (data: any) => {
      if (!isCurrentSocket(userId, sock)) return;

      const historyMessages = data?.messages;
      if (!Array.isArray(historyMessages) || historyMessages.length === 0) return;

      logger.info("[History Sync] Received bulk history", {
        userId,
        messageCount: historyMessages.length,
      });

      let stored = 0;
      const touchedContacts = new Set<string>();

      for (const msg of historyMessages) {
        if (!isCurrentSocket(userId, sock)) return;

        try {
          const jid = msg.key?.remoteJid ?? "";
          if (!isIndividualJid(jid)) continue;

          const text = extractTextFromMessage(msg.message);
          if (!text) continue;

          const contactPhone = jidToContactId(jid);
          if (!msg.key.fromMe && typeof msg.pushName === "string" && msg.pushName.trim()) {
            upsertContactName(userId, contactPhone, msg.pushName);
          }
          const sender = msg.key.fromMe ? "me" : "contact";
          const ts = msg.messageTimestamp
            ? new Date(Number(msg.messageTimestamp) * 1000)
            : new Date();

          await storeMessage(userId, contactPhone, text, sender, ts, { skipTrim: true });
          touchedContacts.add(contactPhone);
          stored++;
        } catch {
          // best-effort — skip individual message failures
        }
      }

      const trimPromises: Array<Promise<void>> = [];
      touchedContacts.forEach((contactPhone) => {
        trimPromises.push((async () => {
          try {
            await trimMessageHistoryForContact(userId, contactPhone);
          } catch (error) {
            logger.warn("Failed to trim history after backfill", {
              userId,
              contactPhone,
              error: String(error),
            });
          }
        })());
      });
      await Promise.all(trimPromises);

      logger.info("[History Sync] Stored bulk history messages", {
        userId,
        storedCount: stored,
        trimmedContacts: touchedContacts.size,
      });
    });

    // ── Route ALL messages.upsert events ─────────────────────────────────────
    sock.ev.on("messages.upsert", async ({ messages, type }) => {
      if (!isCurrentSocket(userId, sock)) return;

      logger.info("[Message Upsert] Event", { userId, type, count: messages.length });

      for (const msg of messages) {
        if (!isCurrentSocket(userId, sock)) return;

        const jid = msg.key.remoteJid ?? "";
        if (!isIndividualJid(jid)) continue;

        const text = extractTextFromMessage(msg.message);
        if (!text) continue;

        const contactPhone = jidToContactId(jid);
        if (!msg.key.fromMe && typeof msg.pushName === "string" && msg.pushName.trim()) {
          upsertContactName(userId, contactPhone, msg.pushName);
        }
        const sender = msg.key.fromMe ? "me" : "contact";

        // Store every message (both history-append and real-time-notify)
        const ts =
          type === "append" && msg.messageTimestamp
            ? new Date(Number(msg.messageTimestamp) * 1000)
            : new Date();

        storeMessage(userId, contactPhone, text, sender, ts).catch((e) => {
          logger.error("Failed to store message", {
            userId,
            contactPhone,
            error: String(e),
          });
        });

        // Only respond to real-time messages
        if (type !== "notify") continue;

        if (msg.key.fromMe) {
          // Handle own-message commands: !me, !mimic, !refresh, !ai status
          if (text.trim().startsWith("!")) {
            const ctxInfo = getContextInfoFromMessage(msg.message);
            const commandContext: OwnCommandContext = {
              quotedText: extractTextFromMessage(ctxInfo?.quotedMessage) || undefined,
              quotedMessage: ctxInfo?.quotedMessage,
              quotedStanzaId: ctxInfo?.stanzaId,
              quotedParticipant: ctxInfo?.participant,
              quotedRemoteJid: ctxInfo?.remoteJid,
            };

            handleOwnCommand(userId, jid, contactPhone, text, msg.key, commandContext).catch((e) =>
              logger.error("Own command handler failed", {
                userId,
                jid,
                error: String(e),
              })
            );
          }
        } else {
          const ctxInfo = getContextInfoFromMessage(msg.message);
          const quotedText = extractTextFromMessage(ctxInfo?.quotedMessage) || undefined;
          const isContactCommand = text.trim().startsWith("!");

          if (isContactCommand) {
            await handleAIResponse(userId, jid, contactPhone, text, {
              quotedText,
              forceCommand: true,
            });
            continue;
          }

          // Chatbot flows fire immediately (no buffering needed)
          const flowMatched = await executeFlows(userId, jid, text);
          if (flowMatched) continue;

          // Auto-reply fires immediately (no buffering needed)
          const autoReplied = await handleAutoReply(userId, jid, text);
          if (autoReplied) continue;

          // Only AI mimic mode needs buffering to combine rapid messages
          const bufferKey = `${userId}_${contactPhone}`;
          bufferIncomingMessage(bufferKey, text, async (combinedText) => {
            await handleAIResponse(userId, jid, contactPhone, combinedText, { quotedText });
          });
        }
      }
    });

    sock.ev.on("creds.update", () => {
      if (!isCurrentSocket(userId, sock)) return;
      void saveCreds().catch((error) => {
        logger.warn("Failed to persist WhatsApp credentials", {
          userId,
          error: String(error),
        });
      });
    });
  } finally {
    inFlightInits.delete(userId);
  }
}

/** Disconnect a user's WhatsApp, unlink credentials, and clear runtime state. */
export async function disconnect(userId: string): Promise<void> {
  clearReconnectTimer(userId);
  explicitDisconnects.add(userId);
  inFlightInits.delete(userId);

  try {
    const socket = getSessionIfExists(userId)?.socket;
    if (socket) {
      try {
        await socket.logout();
      } catch (error) {
        logger.warn("WhatsApp logout failed, forcing socket end", {
          userId,
          error: String(error),
        });
      }
      destroySocket(userId, socket);
    }

    try {
      clearAuthState(userId);
    } catch (error) {
      logger.warn("Failed to clear WhatsApp auth directory on disconnect", {
        userId,
        error: String(error),
      });
    }
    clearRuntimeState(userId);
    removeSession(userId);
    logger.info("WhatsApp disconnected and unlinked", { userId });
  } finally {
    explicitDisconnects.delete(userId);
  }
}

/** Return connection status and QR code for a specific user. */
export function getStatus(userId: string) {
  const session = getSessionIfExists(userId);
  if (!session) {
    return { status: "disconnected", qr: undefined };
  }
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
