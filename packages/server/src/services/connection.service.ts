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
import { logger } from "../lib/logger";
import {
  getSession,
  getSessionIfExists,
  setSession,
  removeSession,
  extractTextFromMessage,
  getContextInfoFromMessage,
  isIndividualJid,
  jidToContactId,
  getSocketFor,
  toJid,
} from "./wa-socket";
import { handleAutoReply } from "./autoreply.service";
import {
  storeMessage,
  trimMessageHistoryForContact,
  getMessageCount,
  getMessageHistory,
} from "./ai-assistant.service";
import {
  parseCommand,
  executeCommand,
  isMimicEnabledForContact,
  clearMimicSettingsForUser,
  type CommandResult,
} from "./message-handler.service";
import { generateResponse, generatePersonaAIDescription } from "./ai-response.service";
import { getPersona, extractPersona, savePersona } from "./ai-persona.service";
import {
  bufferIncomingMessage,
  sendSegmented,
  sendSegments,
  clearBufferedMessagesForUser,
} from "./segment.service";
import { addScheduledMessage } from "./schedule.service";
import { db } from "../db";
import { aiSettings, messageLog } from "../db/schema";

// ─── Per-user auth directory ──────────────────────────────────────────────────

const WA_AUTH_ROOT = "./wa-auth";

function authDir(userId: string): string {
  return `${WA_AUTH_ROOT}/${userId}`;
}

// Track contacts whose history backfill has already been requested
const backfilledContacts = new Map<string, number>();
const reconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();
const inFlightInits = new Set<string>();
const explicitDisconnects = new Set<string>();
const BACKFILL_TTL_MS = 6 * 60 * 60 * 1000;
const BACKFILL_MAX_ENTRIES = 4000;
const BACKFILL_TARGET_MESSAGES = 500;
const MEDIA_DOWNLOAD_COMMAND_LOGGER = pino({ level: "silent" });

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

function pruneBackfillTracker(now: number = Date.now()): void {
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

function hasRecentBackfillRequest(backfillKey: string, now: number = Date.now()): boolean {
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

function markBackfillRequested(backfillKey: string): void {
  const now = Date.now();
  backfilledContacts.set(backfillKey, now);
  pruneBackfillTracker(now);
}

function clearBackfillTrackerForUser(userId: string): void {
  const prefix = `${userId}_`;
  const keysToDelete: string[] = [];
  backfilledContacts.forEach((_, key) => {
    if (key.startsWith(prefix)) {
      keysToDelete.push(key);
    }
  });
  keysToDelete.forEach((key) => backfilledContacts.delete(key));
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
}

interface ParsedReminderIntent {
  task: string;
  scheduledAt: Date;
}

interface OwnCommandContext {
  quotedText?: string;
  quotedMessage?: proto.IMessage | null;
  quotedStanzaId?: string | null;
  quotedParticipant?: string | null;
  quotedRemoteJid?: string | null;
}

interface QuotedMediaDescriptor {
  kind: "image" | "video" | "audio" | "document" | "sticker";
  caption?: string;
  mimetype?: string;
  fileName?: string;
  ptt?: boolean;
}

function parseReminderIntent(input: string, now: Date = new Date()): ParsedReminderIntent | null {
  const trimmed = input.trim().replace(/\s+/g, " ");
  const standardizedIntent = parseStandardizedReminderIntent(trimmed, now);
  if (standardizedIntent) {
    return standardizedIntent;
  }

  const relativeIntent = parseRelativeReminderIntent(trimmed, now);
  if (relativeIntent) {
    return relativeIntent;
  }

  const absoluteMatch = trimmed.match(/^remind me to\s+(.+?)\s+at\s+(.+)$/i);
  if (!absoluteMatch) return null;

  const task = normalizeReminderTask(absoluteMatch[1] ?? "");
  const timeText = (absoluteMatch[2] ?? "").trim().replace(/[.!?]+$/, "");
  if (!task || !timeText) return null;

  const scheduledAt = parseReminderDateTime(timeText, now);
  if (!scheduledAt) return null;

  return { task, scheduledAt };
}

function parseStandardizedReminderIntent(input: string, now: Date): ParsedReminderIntent | null {
  const standardMatch = input.match(
    /^-?r\s*-\s*(.+?)\s*-\s*-?(\d+)\s*(seconds?|secs?|s|minutes?|mins?|min|m|hours?|hrs?|hr|h|days?|day|d|din|ghanta|ghante)\.?$/i
  );
  if (!standardMatch) {
    return null;
  }

  const task = normalizeReminderTask(standardMatch[1] ?? "");
  const amount = Number(standardMatch[2] ?? "");
  const unitMs = parseReminderUnitMs((standardMatch[3] ?? "").toLowerCase());

  if (!task || !Number.isFinite(amount) || amount <= 0 || !unitMs) {
    return null;
  }

  return { task, scheduledAt: new Date(now.getTime() + amount * unitMs) };
}

function parseRelativeReminderIntent(input: string, now: Date): ParsedReminderIntent | null {
  const patterns: Array<{
    pattern: RegExp;
    amountIndex: number;
    unitIndex: number;
    taskIndex: number;
  }> = [
    {
      // Example: "remind me to pay bill in 5 minutes"
      pattern:
        /^remind me to\s+(.+?)\s+in\s+(\d+)\s*(seconds?|secs?|s|minutes?|mins?|min|m|hours?|hrs?|hr|h|days?|day|d|din|ghanta|ghante)\.?$/i,
      amountIndex: 2,
      unitIndex: 3,
      taskIndex: 1,
    },
    {
      // Example: "remind me in 5 minutes to pay bill"
      pattern:
        /^remind me in\s+(\d+)\s*(seconds?|secs?|s|minutes?|mins?|min|m|hours?|hrs?|hr|h|days?|day|d|din|ghanta|ghante)\s+to\s+(.+?)\.?$/i,
      amountIndex: 1,
      unitIndex: 2,
      taskIndex: 3,
    },
    {
      // Example: "5 minute baad mujhe lights band karne ki yaad dilaana"
      pattern:
        /^(\d+)\s*(seconds?|secs?|s|minutes?|mins?|min|m|hours?|hrs?|hr|h|days?|day|d|din|ghanta|ghante)\s+baad\s+(?:mujhe\s+)?(.+?)\s+yaad\s+dila(?:\s+de)?(?:na|ana|do|dena|diji(?:ye|ega))\.?$/i,
      amountIndex: 1,
      unitIndex: 2,
      taskIndex: 3,
    },
    {
      // Example: "mujhe lights band karna 5 minute baad yaad dilaana"
      pattern:
        /^(?:mujhe\s+)?(.+?)\s+(\d+)\s*(seconds?|secs?|s|minutes?|mins?|min|m|hours?|hrs?|hr|h|days?|day|d|din|ghanta|ghante)\s+baad\s+yaad\s+dila(?:\s+de)?(?:na|ana|do|dena|diji(?:ye|ega))\.?$/i,
      amountIndex: 2,
      unitIndex: 3,
      taskIndex: 1,
    },
  ];

  for (const patternDef of patterns) {
    const match = input.match(patternDef.pattern);
    if (!match) {
      continue;
    }

    const amount = Number(match[patternDef.amountIndex] ?? "");
    if (!Number.isFinite(amount) || amount <= 0) {
      continue;
    }

    const unitMs = parseReminderUnitMs((match[patternDef.unitIndex] ?? "").toLowerCase());
    if (!unitMs) {
      continue;
    }

    const task = normalizeReminderTask(match[patternDef.taskIndex] ?? "");
    if (!task) {
      continue;
    }

    const scheduledAt = new Date(now.getTime() + amount * unitMs);
    if (scheduledAt.getTime() <= now.getTime()) {
      continue;
    }

    return { task, scheduledAt };
  }

  return null;
}

function parseReminderUnitMs(unit: string): number | null {
  if (/^(second|seconds|sec|secs|s)$/.test(unit)) return 1000;
  if (/^(minute|minutes|min|mins|m)$/.test(unit)) return 60 * 1000;
  if (/^(hour|hours|hr|hrs|h|ghanta|ghante)$/.test(unit)) return 60 * 60 * 1000;
  if (/^(day|days|d|din)$/.test(unit)) return 24 * 60 * 60 * 1000;
  return null;
}

function normalizeReminderTask(task: string): string {
  return task
    .trim()
    .replace(/[.!?]+$/, "")
    .replace(/\s+/g, " ")
    .replace(/\b(ki|ko|ke|kay|please)\s*$/i, "")
    .trim();
}

function parseReminderDateTime(input: string, now: Date): Date | null {
  const lowered = input.toLowerCase();
  const hasTomorrow = /\btomorrow\b/.test(lowered);
  const normalized = lowered.replace(/\btomorrow\b/g, "").trim();

  const amPmMatch = normalized.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i);
  if (amPmMatch) {
    let hour = Number(amPmMatch[1]);
    const minute = Number(amPmMatch[2] ?? "0");
    const period = (amPmMatch[3] ?? "").toLowerCase();

    if (hour < 1 || hour > 12 || minute < 0 || minute > 59) return null;
    if (period === "pm" && hour !== 12) hour += 12;
    if (period === "am" && hour === 12) hour = 0;

    const target = new Date(now);
    target.setSeconds(0, 0);
    target.setHours(hour, minute, 0, 0);
    if (hasTomorrow || target.getTime() <= now.getTime()) {
      target.setDate(target.getDate() + 1);
    }
    return target;
  }

  const twentyFourMatch = normalized.match(/^(\d{1,2}):(\d{2})$/);
  if (twentyFourMatch) {
    const hour = Number(twentyFourMatch[1]);
    const minute = Number(twentyFourMatch[2]);
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;

    const target = new Date(now);
    target.setSeconds(0, 0);
    target.setHours(hour, minute, 0, 0);
    if (hasTomorrow || target.getTime() <= now.getTime()) {
      target.setDate(target.getDate() + 1);
    }
    return target;
  }

  const parsed = Date.parse(input);
  if (!Number.isNaN(parsed)) {
    const target = new Date(parsed);
    if (target.getTime() > now.getTime()) return target;
  }

  return null;
}

function formatReminderConfirmation(task: string, scheduledAt: Date): string {
  return [
    "⏰ Reminder scheduled",
    `• Task: ${task}`,
    `• Time: ${scheduledAt.toLocaleString()}`,
  ].join("\n");
}

function getQuotedMediaDescriptor(quotedMessage?: proto.IMessage | null): QuotedMediaDescriptor | null {
  const content = extractMessageContent(quotedMessage) ?? normalizeMessageContent(quotedMessage);
  if (!content) return null;

  if (content.imageMessage) {
    return {
      kind: "image",
      caption: content.imageMessage.caption ?? undefined,
      mimetype: content.imageMessage.mimetype ?? undefined,
    };
  }

  if (content.videoMessage) {
    return {
      kind: "video",
      caption: content.videoMessage.caption ?? undefined,
      mimetype: content.videoMessage.mimetype ?? undefined,
    };
  }

  if (content.audioMessage) {
    return {
      kind: "audio",
      mimetype: content.audioMessage.mimetype ?? undefined,
      ptt: content.audioMessage.ptt ?? undefined,
    };
  }

  if (content.documentMessage) {
    return {
      kind: "document",
      caption: content.documentMessage.caption ?? undefined,
      mimetype: content.documentMessage.mimetype ?? undefined,
      fileName: content.documentMessage.fileName ?? undefined,
    };
  }

  if (content.stickerMessage) {
    return { kind: "sticker" };
  }

  return null;
}

function buildMediaResendPayload(
  mediaBuffer: Buffer,
  descriptor: QuotedMediaDescriptor
): Record<string, unknown> {
  switch (descriptor.kind) {
    case "image":
      return {
        image: mediaBuffer,
        caption: descriptor.caption,
        mimetype: descriptor.mimetype,
      };

    case "video":
      return {
        video: mediaBuffer,
        caption: descriptor.caption,
        mimetype: descriptor.mimetype,
      };

    case "audio":
      return {
        audio: mediaBuffer,
        mimetype: descriptor.mimetype,
        ptt: descriptor.ptt ?? false,
      };

    case "document":
      return {
        document: mediaBuffer,
        caption: descriptor.caption,
        mimetype: descriptor.mimetype,
        fileName: descriptor.fileName || "downloaded-media",
      };

    case "sticker":
      return { sticker: mediaBuffer };
  }

  const exhaustiveCheck: never = descriptor.kind;
  throw new Error(`Unsupported media type: ${exhaustiveCheck}`);
}

function resolveMediaDownloadTargetJid(jid: string, command: CommandResult): string {
  if (command.data?.target === "here") {
    return jid;
  }

  if (command.data?.target === "number") {
    const raw = String(command.data.number ?? "").trim();
    if (!raw) {
      throw new Error("Missing target number. Use !me -d -n {number}.");
    }

    if (raw.includes("@")) {
      return raw;
    }

    const digits = raw.replace(/\D/g, "");
    if (!digits) {
      throw new Error("Invalid target number. Use digits only.");
    }

    return toJid(digits);
  }

  throw new Error("Invalid target. Use !me -d -here or !me -d -n {number}.");
}

async function sendQuotedMediaCopy(
  userId: string,
  jid: string,
  command: CommandResult,
  commandContext?: OwnCommandContext
): Promise<string> {
  const quotedMessage = commandContext?.quotedMessage;
  if (!quotedMessage) {
    throw new Error("Reply to a once-view media message first.");
  }

  const descriptor = getQuotedMediaDescriptor(quotedMessage);
  if (!descriptor) {
    throw new Error("The replied message has no downloadable media.");
  }

  const sourceForDownload = {
    key: {
      id: commandContext?.quotedStanzaId ?? undefined,
      remoteJid: commandContext?.quotedRemoteJid || jid,
      participant: commandContext?.quotedParticipant ?? undefined,
      fromMe: false,
    },
    message: quotedMessage,
  } as any;

  const sock = getSocketFor(userId);
  const mediaBuffer = await downloadMediaMessage(
    sourceForDownload,
    "buffer",
    {},
    {
      logger: MEDIA_DOWNLOAD_COMMAND_LOGGER as any,
      reuploadRequest: sock.updateMediaMessage,
    }
  );

  const targetJid = resolveMediaDownloadTargetJid(jid, command);
  const payload = buildMediaResendPayload(mediaBuffer, descriptor);
  await sock.sendMessage(targetJid, payload as any);

  if (targetJid === jid) {
    return "✅ Media copied to this chat.";
  }

  const targetLabel = targetJid.includes("@") ? targetJid.split("@")[0] : targetJid;
  return `✅ Media sent to ${targetLabel}.`;
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

          // Buffer rapid incoming messages, then run the full AI flow
          const bufferKey = `${userId}_${contactPhone}`;
          bufferIncomingMessage(bufferKey, text, async (combinedText) => {
            // Auto-reply takes priority — skip AI if a rule matched
            const autoReplied = await handleAutoReply(userId, jid, combinedText);
            if (!autoReplied) {
              await handleAIResponse(userId, jid, contactPhone, combinedText, { quotedText });
            }
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

// ─── AI Response Flow ─────────────────────────────────────────────────────────

/**
 * Full AI response flow for incoming contact messages.
 *
 * Flow:
 *  1. Check if AI is enabled globally
 *  2. Check message count – if < 500, request history backfill (best-effort)
 *  3. Check if persona exists – if not, extract and save it
 *  4. Generate AI response using persona + last 50 messages
 *  5. Send segmented response to contact
 */
async function handleAIResponse(
  userId: string,
  jid: string,
  contactPhone: string,
  text: string,
  options?: { quotedText?: string; forceCommand?: boolean }
): Promise<void> {
  const tag = `[AI ${contactPhone}]`;
  const quotedText = options?.quotedText;
  const forceCommand = options?.forceCommand ?? false;

  try {
    // ── Step 1: Check AI settings ─────────────────────────────────────────
    logger.info(`${tag} Step 1: Checking AI settings`, { userId });

    const settingsRows = await db
      .select({ aiEnabled: aiSettings.aiEnabled, botName: aiSettings.botName })
      .from(aiSettings)
      .where(eq(aiSettings.userId, userId))
      .limit(1);

    const aiEnabled = settingsRows[0]?.aiEnabled ?? false;
    const botName = settingsRows[0]?.botName?.trim();

    let aiMode: "mimic" | "bot" = "mimic";
    let promptText = text;

    if (botName) {
      const botCmdRegex = new RegExp(`^!${botName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+(.+)$`, "i");
      const botMatch = text.trim().match(botCmdRegex);
      if (botMatch) {
         aiMode = "bot";
         promptText = botMatch[1];
         logger.info(`${tag} Bot explicitly invoked by contact`, { userId, botName });
       }
    }
    const rawBotPrompt = promptText;

    if (forceCommand && aiMode !== "bot") {
      logger.info(`${tag} Command-style message ignored (not bot command)`, { userId });
      return;
    }

    if (!aiEnabled && aiMode !== "bot") {
      logger.info(`${tag} AI is disabled globally, skipping`, { userId });
      return;
    }

    // ── Check per-contact mimic toggle ────────────────────────────────────
    // Default is enabled (opt-out model). Only skip if explicitly turned off via !mimic off.
    // If contact explicitly invoked the bot, bypass the mimic check
    if (!isMimicEnabledForContact(userId, contactPhone) && aiMode !== "bot") {
      logger.info(`${tag} Mimic disabled for this contact, skipping`, { userId });
      return;
    }

    if (aiMode === "bot" && quotedText) {
      promptText = `Replied message: "${quotedText}"\n\nMy question: ${promptText}`;
    }

    const reminderIntent = aiMode === "bot" ? parseReminderIntent(rawBotPrompt) : null;
    if (reminderIntent) {
      const scheduled = await addScheduledMessage(
        userId,
        jid,
        `⏰ Reminder: ${reminderIntent.task}`,
        reminderIntent.scheduledAt.toISOString()
      );

      await sendSegmented(
        userId,
        jid,
        formatReminderConfirmation(
          reminderIntent.task,
          new Date(scheduled.scheduledAt)
        )
      );
      logger.info(`${tag} Smart reminder created from bot command`, { userId });
      return;
    }

    logger.info(`${tag} AI is enabled`, { userId });

    // ── Step 2: Check message count & request backfill ────────────────────
    const msgCount = await getMessageCount(userId, contactPhone);
    logger.info(`${tag} Step 2: Message count = ${msgCount}`, { userId });

    if (msgCount < BACKFILL_TARGET_MESSAGES) {
      const backfillKey = `${userId}_${contactPhone}`;
      if (!hasRecentBackfillRequest(backfillKey)) {
        markBackfillRequested(backfillKey);
        logger.info(`${tag} Requesting history backfill (have ${msgCount}, want 500)`, { userId });
        try {
          const sock = getSocketFor(userId);
          // fetchMessageHistory is fire-and-forget; results arrive via messages.upsert/append
          // NOTE: This method may not exist in all Baileys versions - wrapped in try/catch
          await (sock as any).fetchMessageHistory(
            500,
            { remoteJid: jid, fromMe: false, id: "" },
            0
          );
          logger.info(`${tag} History backfill requested`, { userId });
        } catch (e) {
          logger.warn(`${tag} History backfill failed (non-critical)`, {
            userId,
            error: String(e),
          });
        }
      }
    }

    // ── Step 3: Ensure persona exists ─────────────────────────────────────
    let persona = await getPersona(userId, contactPhone);
    logger.info(`${tag} Step 3: Persona exists = ${!!persona}`, { userId });

    if (!persona) {
      const freshCount = await getMessageCount(userId, contactPhone);
      if (freshCount >= 5) {
        logger.info(`${tag} Generating persona from ${freshCount} messages`, { userId });

        // Rule-based extraction first (fast, always works)
        persona = await extractPersona(userId, contactPhone, Math.min(freshCount, 500));

        // Try to enrich with AI-generated voice description
        logger.info(`${tag} Generating AI persona description`, { userId });
        try {
          const history = await getMessageHistory(userId, contactPhone, Math.min(freshCount, 100));
          const aiDescription = await generatePersonaAIDescription(userId, contactPhone, history);
          if (aiDescription) {
            persona.aiDescription = aiDescription;
            logger.info(`${tag} AI persona description generated`, { userId });
          }
        } catch (e) {
          logger.warn(`${tag} AI persona description failed (using rule-based only)`, {
            userId,
            error: String(e),
          });
        }

        await savePersona(userId, contactPhone, persona);
        logger.info(`${tag} Persona saved`, { userId });
      } else {
        logger.info(`${tag} Only ${freshCount} messages — will use default persona`, { userId });
      }
    }

    // ── Step 4: Generate AI response ──────────────────────────────────────
    logger.info(`${tag} Step 4: Generating AI response`, { userId, textLen: promptText.length, mode: aiMode });
    const result = await generateResponse(userId, contactPhone, promptText, aiMode);
    logger.info(`${tag} Response generated`, {
      userId,
      provider: result.provider,
      responseLen: result.response.length,
      segmentCount: result.segments.length,
      tokensUsed: result.tokensUsed,
    });

    // ── Step 5: Send response (use AI segments if available) ──────────────
    logger.info(`${tag} Step 5: Sending response`, { userId });
    const sentText = result.response;
    if (result.segments.length > 0) {
      await sendSegments(userId, jid, result.segments);
      logger.info(`${tag} Response sent in ${result.segments.length} AI segment(s)`, { userId });
    } else {
      const fallbackSegments = await sendSegmented(userId, jid, sentText);
      logger.info(`${tag} Response sent in ${fallbackSegments.length} fallback segment(s)`, { userId });
    }

    // ── Log AI response to messageLog ─────────────────────────────────────
    try {
      await db.insert(messageLog).values({
        id: crypto.randomUUID(),
        userId,
        type: "ai",
        phone: contactPhone,
        message: sentText.substring(0, 500), // cap to reasonable length
        status: "sent",
        createdAt: new Date(),
      });
    } catch (logErr) {
      logger.warn(`${tag} Failed to log AI message`, { userId, error: String(logErr) });
    }
  } catch (e) {
    logger.error(`${tag} AI response flow failed`, {
      userId,
      contactPhone,
      error: String(e),
    });
  }
}

// ─── Own-message command handler ──────────────────────────────────────────────

/**
 * Edit a sent message (fromMe) in-place using Baileys message editing.
 */
async function editOwnMessage(
  userId: string,
  jid: string,
  msgKey: { remoteJid?: string | null; fromMe?: boolean | null; id?: string | null },
  newText: string
): Promise<void> {
  try {
    const sock = getSocketFor(userId);
    await sock.sendMessage(jid, { text: newText, edit: msgKey as any });
  } catch (e) {
    logger.warn("[Command] Failed to edit message", { userId, error: String(e) });
  }
}

/**
 * Handle own-message (fromMe) commands: !me, !{botName}, !mimic, !refresh, !ai status, !me -d.
 *
 * Flow for ALL commands:
 *   1. Immediately edits the sent command message to "⏳ Processing..."
 *   2. Download commands (!me -d ...):
 *        - Edits to "⏳ Downloading media..." while downloading
 *        - Edits to success/error text after resend
 *   3. AI commands (!me / !{botName}):
 *        - Edits to "⏳ Generating..." while waiting for the AI
 *        - Edits to "✅" once done, then sends the AI reply as new messages
 *   4. Settings commands (!mimic, !ai status, !refresh):
 *        - Edits directly to the result text
 *
 * NOTE: These commands ALWAYS run regardless of whether the global AI mimic is
 * enabled or disabled — the owner must always be able to query the AI and tweak
 * settings from any chat.
 *
 * Reply context: when the user replies to a WhatsApp message and sends
 * !me / !{botName}, the quoted message text (quotedText) is injected into the
 * AI prompt even if it is not yet stored in the context database.
 */
async function handleOwnCommand(
  userId: string,
  jid: string,
  contactPhone: string,
  text: string,
  msgKey: { remoteJid?: string | null; fromMe?: boolean | null; id?: string | null },
  commandContext?: OwnCommandContext
): Promise<void> {
  // Immediately show a processing indicator in the sent message
  await editOwnMessage(userId, jid, msgKey, "⏳ Processing...");
  const quotedText = commandContext?.quotedText;

  let resolvedText = text;

  // Resolve !{botName} → !me so the owner can use their custom bot alias
  try {
    const settingsRow = await db
      .select({ botName: aiSettings.botName })
      .from(aiSettings)
      .where(eq(aiSettings.userId, userId))
      .limit(1);
    const botName = settingsRow[0]?.botName?.trim();
    if (botName) {
      const botCmdRegex = new RegExp(`^!${botName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+(.+)$`, "i");
      const botMatch = text.trim().match(botCmdRegex);
      if (botMatch) {
        resolvedText = `!me ${botMatch[1]}`;
      }
    }
  } catch {
    // non-critical
  }

  const command = parseCommand(resolvedText);
  
  // Debug logging to trace command parsing issues
  logger.info("[Command] Parsed result", { 
    userId, 
    originalText: text.substring(0, 50),
    resolvedText: resolvedText.substring(0, 50),
    commandType: command?.type || "null",
    hasContent: !!command?.content
  });
  
  if (!command.type) {
    // Not a recognised command — restore the original text
    await editOwnMessage(userId, jid, msgKey, text);
    return;
  }

  // ── Media download command (!me -d ...) ──────────────────────────────────────
  if (command.type === "download_media") {
    try {
      await editOwnMessage(userId, jid, msgKey, "⏳ Downloading media...");
      const resultMessage = await sendQuotedMediaCopy(userId, jid, command, commandContext);
      await editOwnMessage(userId, jid, msgKey, resultMessage);
    } catch (e) {
      logger.error("[Command] Media download failed", { userId, contactPhone, error: String(e) });
      await editOwnMessage(userId, jid, msgKey, `❌ ${String((e as Error)?.message || e)}`);
    }
    return;
  }

  // ── AI explain commands (!me / !{botName}) ──────────────────────────────────
  if (command.type === "explain") {
    try {
      const reminderIntent = parseReminderIntent(command.content ?? "");
      if (reminderIntent) {
        const scheduled = await addScheduledMessage(
          userId,
          jid,
          `⏰ Reminder: ${reminderIntent.task}`,
          reminderIntent.scheduledAt.toISOString()
        );
        await editOwnMessage(
          userId,
          jid,
          msgKey,
          formatReminderConfirmation(reminderIntent.task, new Date(scheduled.scheduledAt))
        );
        return;
      }

      await editOwnMessage(userId, jid, msgKey, "⏳ Generating...");

      // Build the AI prompt content.
      // If the user replied to a message, prepend the quoted text so the AI can
      // reference it even when it is not in the stored conversation history.
      let aiContent = command.content!;
      if (quotedText) {
        aiContent = `Replied message: "${quotedText}"\n\nMy question: ${command.content}`;
      }

      logger.info("[AI !me] Generating explain response", { userId, contactPhone, hasQuotedText: !!quotedText });
      const result = await generateResponse(userId, contactPhone, aiContent, "explain");

      // Edit the command message to ✅, then send the AI answer as new message(s)
      await editOwnMessage(userId, jid, msgKey, "✅");
      await sendSegmented(userId, jid, result.response);
      logger.info("[AI !me] Explain response sent", { userId, contactPhone, provider: result.provider });
    } catch (e: any) {
      logger.error("[AI !me] Explain response failed", { userId, contactPhone, error: String(e) });
      const errorMessage = String(e?.message || e);
      const errText =
        errorMessage.includes("keys configured") || errorMessage.includes("unavailable")
          ? `⚠️ AI Error: ${errorMessage}`
          : "❌ Failed to generate AI response. Check server logs.";
      await editOwnMessage(userId, jid, msgKey, errText);
    }
    return;
  }

  // ── Settings / info commands (!mimic, !mimic global, !refresh, !ai status) ──
  try {
    const response = await executeCommand(userId, contactPhone, command);
    await editOwnMessage(userId, jid, msgKey, response || "✅ Done");
  } catch (e) {
    logger.error("Command execution failed", { userId, contactPhone, error: String(e) });
    await editOwnMessage(userId, jid, msgKey, "❌ Command failed. Check server logs.");
  }
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
