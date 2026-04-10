import { handleOwnCommand, handleAIResponse, OwnCommandContext } from "../../messaging/services";
import { executeFlows } from "../../flow/services";
import crypto from "crypto";
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
import { logger } from "../../../core/logger";
import {
  getSession,
  getSessionIfExists,
  setSession,
  removeSession,
  extractTextFromMessage,
  getContextInfoFromMessage,
  jidToContactId,
  getSocketFor,
  toJid,
  clearBackfillTrackerForUser,
  clearContactNamesForUser,
  upsertContactName,
  upsertContactNames,
} from "./socket";
import { handleAutoReply } from "../../auto-reply/services";
import {
  parseCommand,
  executeCommand,
  isMimicEnabledForContact,
  clearMimicSettingsForUser,
  type CommandResult,
} from "../../messaging/services";
import { generateResponse, generatePersonaAIDescription } from "../../ai/services";
import { getPersona, extractPersona, savePersona } from "../../ai/services";
import {
  bufferIncomingMessage,
  sendSegmented,
  sendSegments,
  clearBufferedMessagesForUser,
} from "../../messaging/services";
import { addScheduledMessage, restoreScheduledMessagesForUser } from "../../scheduling/services";
import { createTrialUsageRecord, getTrialUsageByPhoneNumber, normalizeTrialPhoneNumber } from "../../../core/trial";
import { db } from "../../../database";
import { aiSettings, messageLog } from "../../../database";
import { resolveChatTypeFromJid } from "./chat-jid";
import {
  getChatHistoryLimit,
  persistChatsToDb,
  storeChatMessage,
  trimChatMessagesForChat,
} from "./chats";
import {
  appendLiveThreadMessage,
  clearLiveChatsForUser,
  ingestChatsDelete,
  ingestChatsUpdate,
  ingestChatsUpsert,
  touchChatFromMessage,
} from "./live-chat-registry";

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
  clearLiveChatsForUser(userId);
}

function detectMediaKind(message: proto.IMessage | null | undefined): string | null {
  if (!message) return null;
  if (message.imageMessage) return "image";
  if (message.videoMessage) return "video";
  if (message.audioMessage) return message.audioMessage.ptt ? "voice" : "audio";
  if (message.documentMessage) return "document";
  if (message.stickerMessage) return "sticker";
  return null;
}

// ─── Connection ───────────────────────────────────────────────────────────────

/**
 * Actively fetch all participating group metadata and ingest them into the
 * live chat registry + store so the Communities tab shows groups immediately.
 */
async function fetchAndIngestGroups(
  userId: string,
  sock: WASocket,
  store: { chats: Map<string, Record<string, unknown>>; contacts: Record<string, Record<string, unknown>> },
): Promise<void> {
  try {
    const groups = await sock.groupFetchAllParticipating();
    const chatBatch: Record<string, unknown>[] = [];
    for (const [jid, metadata] of Object.entries(groups)) {
      const rec: Record<string, unknown> = {
        id: jid,
        jid,
        name: metadata.subject ?? jid,
        subject: metadata.subject,
        // Use creation timestamp so groups appear even without messages
        conversationTimestamp: metadata.creation ? metadata.creation : undefined,
      };
      chatBatch.push(rec);
      store.chats.set(jid, rec);
    }
    if (chatBatch.length > 0) {
      ingestChatsUpsert(userId, chatBatch);
      // Persist groups to DB so they survive server restarts
      persistChatsToDb(userId, chatBatch as any[]).catch(() => {});
      logger.info("Ingested group metadata from WhatsApp", { userId, groupCount: chatBatch.length });
    }
  } catch (e) {
    // groupFetchAllParticipating may fail if disconnected during the call
    logger.warn("fetchAndIngestGroups failed", { userId, error: String(e) });
  }
}

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
      setSession(userId, { socket: null, status: "idle", qr: undefined, lastError: undefined, lastErrorAt: undefined, store: undefined });
    }

    logger.info("WhatsApp initializing", { userId });

    const { state, saveCreds } = await useMultiFileAuthState(authDir(userId));
    const { version } = await fetchLatestBaileysVersion();

    setSession(userId, { status: "waiting_qr", qr: undefined, lastError: undefined, lastErrorAt: undefined });

    const sock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: false,
      logger: pino({ level: "silent" }) as any,
      syncFullHistory: true,
      markOnlineOnConnect: false,
      browser: ["Ubuntu", "Chrome", "110.0.5481.77"],
    });

    // Lightweight store: We cache chats and contacts from Baileys events.
    // Baileys v7 removed makeInMemoryStore; we use our own map-based cache.
    const store: { chats: Map<string, Record<string, unknown>>; contacts: Record<string, Record<string, unknown>> } = {
      chats: new Map(),
      contacts: {},
    };

    setSession(userId, { socket: sock, store });

    sock.ev.on("chats.upsert" as any, (batch: unknown[]) => {
      if (!isCurrentSocket(userId, sock) || !Array.isArray(batch)) return;
      ingestChatsUpsert(userId, batch);
      // Populate store.chats for fallback resolution
      for (const item of batch) {
        if (item && typeof item === "object" && !Array.isArray(item)) {
          const rec = item as Record<string, unknown>;
          const id = (typeof rec.id === "string" && rec.id) || (typeof rec.jid === "string" && rec.jid) || "";
          if (id) store.chats.set(id, rec);
        }
      }
      // Persist chat list to DB so it survives server restarts
      persistChatsToDb(userId, batch as any[]).catch(() => {});
    });

    sock.ev.on("chats.update" as any, (batch: unknown[]) => {
      if (!isCurrentSocket(userId, sock) || !Array.isArray(batch)) return;
      ingestChatsUpdate(userId, batch);
      // Merge updates into store.chats
      for (const item of batch) {
        if (item && typeof item === "object" && !Array.isArray(item)) {
          const rec = item as Record<string, unknown>;
          const id = (typeof rec.id === "string" && rec.id) || (typeof rec.jid === "string" && rec.jid) || "";
          if (id) {
            const existing = store.chats.get(id);
            store.chats.set(id, existing ? { ...existing, ...rec } : rec);
          }
        }
      }
    });

    sock.ev.on("chats.delete" as any, (ids: unknown) => {
      if (!isCurrentSocket(userId, sock)) return;
      ingestChatsDelete(userId, ids);
      // Remove from store.chats
      if (Array.isArray(ids)) {
        for (const id of ids) {
          if (typeof id === "string") store.chats.delete(id);
        }
      }
    });

    sock.ev.on("contacts.upsert" as any, (contacts: any[]) => {
      if (!isCurrentSocket(userId, sock) || !Array.isArray(contacts)) return;
      upsertContactNames(userId, contacts as any);
      // Populate store.contacts for fallback resolution
      for (const c of contacts) {
        const id = c?.id ?? c?.jid;
        if (typeof id === "string" && id) {
          store.contacts[id] = c;
        }
      }
    });

    sock.ev.on("contacts.update" as any, (contacts: any[]) => {
      if (!isCurrentSocket(userId, sock) || !Array.isArray(contacts)) return;
      upsertContactNames(userId, contacts as any);
      // Merge contact updates into store.contacts
      for (const c of contacts) {
        const id = c?.id ?? c?.jid;
        if (typeof id === "string" && id) {
          const existing = store.contacts[id];
          store.contacts[id] = existing ? { ...existing, ...c } : c;
        }
      }
    });

    sock.ev.on("connection.update", ({ connection, lastDisconnect, qr }) => {
      if (!isCurrentSocket(userId, sock)) return;

      if (qr) {
        clearReconnectTimer(userId);
        setSession(userId, { qr, status: "waiting_qr", lastError: undefined, lastErrorAt: undefined });
        logger.info("QR code generated", { userId });
      }
      if (connection === "open") {
        const rawConnectedPhone = sock.user?.id ?? "";
        const connectedPhone = normalizeTrialPhoneNumber(jidToContactId(rawConnectedPhone));

        if (!connectedPhone) {
          logger.error("Connected WhatsApp phone could not be resolved", { userId, rawConnectedPhone });
          setSession(userId, {
            status: "disconnected",
            socket: null,
            qr: undefined,
            lastError: "Could not verify connected WhatsApp number. Please try again.",
            lastErrorAt: new Date().toISOString(),
          });
          destroySocket(userId, sock);
          return;
        }

        getTrialUsageByPhoneNumber(connectedPhone)
          .then(async (rows) => {
            const existing = rows[0];
            if (existing && existing.userId !== userId) {
              logger.warn("Duplicate trial phone detected on WhatsApp scan", {
                userId,
                connectedPhone,
                existingUserId: existing.userId,
              });
              setSession(userId, {
                status: "disconnected",
                socket: null,
                qr: undefined,
                lastError: "This WhatsApp number has already used a free trial.",
                lastErrorAt: new Date().toISOString(),
              });
              destroySocket(userId, sock);
              return;
            }

            if (!existing) {
              await createTrialUsageRecord(connectedPhone, userId);
            }

            clearReconnectTimer(userId);
            setSession(userId, { status: "connected", qr: undefined, lastError: undefined, lastErrorAt: undefined });
            logger.info("WhatsApp connected", { userId, connectedPhone });

            // Actively fetch all participating groups to populate the Communities tab.
            // Baileys may not include groups in the initial chats.upsert event.
            fetchAndIngestGroups(userId, sock, store).catch((e) => {
              logger.warn("Failed to fetch groups on connect", { userId, error: String(e) });
            });

            // Restore pending scheduled messages for this active socket
            restoreScheduledMessagesForUser(userId).catch(error => {
              logger.error("Failed to restore scheduled messages for user", { userId, error: String(error) });
            });
          })
          .catch((error) => {
            logger.error("Trial validation failed on WhatsApp connect", {
              userId,
              connectedPhone,
              error: String(error),
            });
            setSession(userId, {
              status: "disconnected",
              socket: null,
              qr: undefined,
              lastError: "Unable to verify trial eligibility. Please try again.",
              lastErrorAt: new Date().toISOString(),
            });
            destroySocket(userId, sock);
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
            lastError: loggedOut ? undefined : getSessionIfExists(userId)?.lastError,
            lastErrorAt: loggedOut ? undefined : getSessionIfExists(userId)?.lastErrorAt,
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

      if (Array.isArray(data?.chats) && data.chats.length > 0) {
        ingestChatsUpsert(userId, data.chats);
        // Populate store.chats from history
        for (const item of data.chats) {
          if (item && typeof item === "object") {
            const id = item.id ?? item.jid ?? "";
            if (typeof id === "string" && id) store.chats.set(id, item);
          }
        }
        // Persist chat list to DB
        persistChatsToDb(userId, data.chats).catch(() => {});
      }

      // History sync also delivers contacts — ingest their names
      if (Array.isArray(data?.contacts) && data.contacts.length > 0) {
        upsertContactNames(userId, data.contacts);
        // Populate store.contacts from history
        for (const c of data.contacts) {
          const id = c?.id ?? c?.jid;
          if (typeof id === "string" && id) {
            store.contacts[id] = c;
          }
        }
      }

      const historyMessages = data?.messages;
      if (!Array.isArray(historyMessages) || historyMessages.length === 0) return;

      logger.info("[History Sync] Received bulk history", {
        userId,
        messageCount: historyMessages.length,
      });

      let stored = 0;
      const touchedChatIds = new Set<string>();
      const chatHistoryLimit = await getChatHistoryLimit(userId);

      for (const msg of historyMessages) {
        if (!isCurrentSocket(userId, sock)) return;

        try {
          const jid = msg.key?.remoteJid ?? "";
          const chatType = resolveChatTypeFromJid(jid);
          if (!chatType) continue;
          const text = extractTextFromMessage(msg.message);
          const hasPayload = Boolean(msg.message);
          if (!hasPayload && !text) continue;

          const sender = msg.key.fromMe ? "me" : "contact";
          const ts = msg.messageTimestamp
            ? new Date(Number(msg.messageTimestamp) * 1000)
            : new Date();

          if (chatType === "direct") {
            const contactPhone = jidToContactId(jid);
            if (!msg.key.fromMe && typeof msg.pushName === "string" && msg.pushName.trim()) {
              upsertContactName(userId, contactPhone, msg.pushName);
            }
          }

          const storedChat = await storeChatMessage(
            userId,
            {
              jid,
              message: msg.message ?? undefined,
              sender,
              timestamp: ts,
              title: !msg.key.fromMe && typeof msg.pushName === "string" ? msg.pushName : undefined,
              waMessage: msg,
            },
            { skipTrim: true, historyLimit: chatHistoryLimit, source: "history" }
          );
          if (storedChat) {
            touchedChatIds.add(storedChat.chatId);
            stored++;
          }

          const preview =
            extractTextFromMessage(msg.message) || (msg.message ? "[Media]" : undefined);
          if (preview || ts) {
            touchChatFromMessage(userId, jid, {
              lastMessage: preview,
              lastMessageAt: ts.toISOString(),
              title: !msg.key.fromMe && typeof msg.pushName === "string" ? msg.pushName : undefined,
            });
            appendLiveThreadMessage(userId, jid, {
              id: msg.key?.id || crypto.randomUUID(),
              sender,
              message: preview || "[Message]",
              timestamp: ts.toISOString(),
              mediaKind: detectMediaKind(msg.message ?? undefined),
              hasMediaPayload: Boolean(msg.message),
            });
          }
        } catch {
          // best-effort — skip individual message failures
        }
      }

      const chatTrimPromises: Array<Promise<void>> = [];
      touchedChatIds.forEach((chatId) => {
        chatTrimPromises.push(
          trimChatMessagesForChat(userId, chatId, chatHistoryLimit).catch((error) => {
            logger.warn("Failed to trim persisted chat history", {
              userId,
              chatId,
              error: String(error),
            });
          })
        );
      });
      await Promise.all(chatTrimPromises);

      logger.info("[History Sync] Stored bulk history messages", {
        userId,
        storedCount: stored,
        trimmedChats: touchedChatIds.size,
      });
    });

    // ── Route ALL messages.upsert events ─────────────────────────────────────
    sock.ev.on("messages.upsert", async ({ messages, type }) => {
      if (!isCurrentSocket(userId, sock)) return;

      logger.info("[Message Upsert] Event", { userId, type, count: messages.length });
      const chatHistoryLimit = await getChatHistoryLimit(userId);

      for (const msg of messages) {
        if (!isCurrentSocket(userId, sock)) return;

        const jid = msg.key.remoteJid ?? "";
        const chatType = resolveChatTypeFromJid(jid);
        if (!chatType) continue;

        const text = extractTextFromMessage(msg.message);
        const hasText = Boolean(text);
        const hasPayload = Boolean(msg.message);
        if (!hasPayload && !hasText) continue;

        const isDirectChat = chatType === "direct";
        const contactPhone = isDirectChat ? jidToContactId(jid) : "";
        if (
          isDirectChat &&
          !msg.key.fromMe &&
          typeof msg.pushName === "string" &&
          msg.pushName.trim()
        ) {
          upsertContactName(userId, contactPhone, msg.pushName);
        }
        const sender = msg.key.fromMe ? "me" : "contact";

        // Store every message (both history-append and real-time-notify)
        const ts =
          type === "append" && msg.messageTimestamp
            ? new Date(Number(msg.messageTimestamp) * 1000)
            : new Date();

        storeChatMessage(
          userId,
          {
            jid,
            message: msg.message ?? undefined,
            sender,
            timestamp: ts,
            title: !msg.key.fromMe && typeof msg.pushName === "string" ? msg.pushName : undefined,
            waMessage: msg,
          },
          {
            historyLimit: chatHistoryLimit,
            source: type === "append" ? "history" : "realtime",
          }
        ).catch((error) => {
          logger.error("Failed to persist chat message", {
            userId,
            jid,
            error: String(error),
          });
        });

        const preview =
          extractTextFromMessage(msg.message) || (msg.message ? "[Media]" : undefined);
        if (preview || ts) {
          touchChatFromMessage(userId, jid, {
            lastMessage: preview,
            lastMessageAt: ts.toISOString(),
            title: !msg.key.fromMe && typeof msg.pushName === "string" ? msg.pushName : undefined,
          });
          appendLiveThreadMessage(userId, jid, {
            id: msg.key?.id || crypto.randomUUID(),
            sender,
            message: preview || "[Message]",
            timestamp: ts.toISOString(),
            mediaKind: detectMediaKind(msg.message ?? undefined),
            hasMediaPayload: Boolean(msg.message),
          });
        }

        // Keep existing automations and command logic scoped to direct chats only.
        if (!isDirectChat) continue;

        // Only respond to real-time messages
        if (type !== "notify") continue;

        if (msg.key.fromMe) {
          // Handle own-message commands: !me, !mimic, !refresh, !ai status
          if (hasText && text.trim().startsWith("!")) {
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
          const isContactCommand = hasText && text.trim().startsWith("!");

          if (isContactCommand) {
            await handleAIResponse(userId, jid, contactPhone, text, {
              quotedText,
              forceCommand: true,
            });
            continue;
          }

          // Chatbot flows fire immediately (no buffering needed)
           const flowMatched = await executeFlows(userId, jid, text ?? "", { receivedAt: ts });
          if (flowMatched) continue;

          if (!hasText) continue;

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
    return { status: "disconnected", qr: undefined, lastError: undefined };
  }
  return { status: session.status, qr: session.qr, lastError: session.lastError };
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
