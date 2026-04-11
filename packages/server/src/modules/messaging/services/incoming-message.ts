import crypto from "crypto";
import { downloadMediaMessage, extractMessageContent, normalizeMessageContent, type proto } from "@whiskeysockets/baileys";
import pino from "pino";
import { eq } from "drizzle-orm";
import { logger } from "../../../core/logger";
import { parseCommand, executeCommand, isMimicEnabledForContact, type CommandResult } from "./handler";
import { generateResponse, generatePersonaAIDescription } from "../../ai/services";
import { getPersona, extractPersona, savePersona, getPersonaLastUpdated } from "../../ai/services";
import { bufferIncomingMessage, sendSegmented, sendSegments } from "./segment";
import { addScheduledMessage } from "../../scheduling/services";
import { db } from "../../../database";
import { aiSettings, messageLog } from "../../../database";
import { extractTextFromMessage, getContextInfoFromMessage, getSocketFor, toJid } from "../../whatsapp/services";
import { handleAutoReply } from "../../auto-reply/services";
import { getMessageCount, getMessageHistory, getMessageCountSince } from "../../ai/services";
import { BACKFILL_TARGET_MESSAGES, hasRecentBackfillRequest, markBackfillRequested } from "../../whatsapp/services";
const MEDIA_DOWNLOAD_COMMAND_LOGGER = pino({ level: "silent" });
const MIN_MESSAGES_FOR_PERSONA = 10;
const MIN_MESSAGES_FOR_AI_DESCRIPTION = 20;
const PERSONA_CONTEXT_WINDOW = 1000;
const PERSONA_REFRESH_THRESHOLD_HOT = 20;
const PERSONA_REFRESH_THRESHOLD_WARM = 30;
const PERSONA_REFRESH_THRESHOLD_COLD = 50;
const PERSONA_HOT_CONTACT_MIN_MESSAGES = 200;
const PERSONA_WARM_CONTACT_MIN_MESSAGES = 80;
const PERSONA_FORCE_REFRESH_AGE_MS = 12 * 60 * 60 * 1000;
const PERSONA_ENRICHMENT_MAX_CONCURRENCY_PER_USER = 2;
const PERSONA_ENRICHMENT_RETRY_ATTEMPTS = 2;

const personaEnrichmentInFlight = new Set<string>();
const personaEnrichmentByUser = new Map<string, number>();

interface ParsedReminderIntent {
  task: string;
  scheduledAt: Date;
}

export interface OwnCommandContext {
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

interface SpamCommandParams {
  message: string;
  count: number;
  delaySeconds: number;
}

function getPersonaRefreshThreshold(totalMessages: number): number {
  if (totalMessages >= PERSONA_HOT_CONTACT_MIN_MESSAGES) return PERSONA_REFRESH_THRESHOLD_HOT;
  if (totalMessages >= PERSONA_WARM_CONTACT_MIN_MESSAGES) return PERSONA_REFRESH_THRESHOLD_WARM;
  return PERSONA_REFRESH_THRESHOLD_COLD;
}

function getPersonaRefreshReason(input: {
  hasPersona: boolean;
  forceRefreshByAge: boolean;
  newMessagesSinceRefresh: number;
  threshold: number;
}): "missing" | "stale" | "new-messages" | "skip" {
  if (!input.hasPersona) return "missing";
  if (input.forceRefreshByAge) return "stale";
  if (input.newMessagesSinceRefresh >= input.threshold) return "new-messages";
  return "skip";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function generatePersonaDescriptionWithRetry(
  userId: string,
  contactPhone: string,
  historyLimit: number
): Promise<string | null> {
  for (let attempt = 0; attempt <= PERSONA_ENRICHMENT_RETRY_ATTEMPTS; attempt++) {
    try {
      const history = await getMessageHistory(userId, contactPhone, historyLimit);
      const userMessages = history.filter((item) => item.sender === "me");
      if (userMessages.length < MIN_MESSAGES_FOR_AI_DESCRIPTION) {
        return null;
      }

      const aiDescription = await generatePersonaAIDescription(userId, contactPhone, history);
      if (aiDescription) {
        return aiDescription;
      }
    } catch (error) {
      if (attempt >= PERSONA_ENRICHMENT_RETRY_ATTEMPTS) {
        logger.warn("[AI] Persona description retries exhausted", {
          userId,
          contactPhone,
          attempt,
          error: String(error),
        });
        break;
      }
      const delayMs = 500 * 2 ** attempt;
      await sleep(delayMs);
    }
  }

  return null;
}

function runPersonaEnrichmentInBackground(
  userId: string,
  contactPhone: string,
  historyLimit: number
): void {
  const key = `${userId}:${contactPhone}`;
  if (personaEnrichmentInFlight.has(key)) {
    return;
  }

  const inFlightForUser = personaEnrichmentByUser.get(userId) ?? 0;
  if (inFlightForUser >= PERSONA_ENRICHMENT_MAX_CONCURRENCY_PER_USER) {
    logger.debug("[AI] Persona enrichment skipped due to concurrency cap", {
      userId,
      contactPhone,
      inFlightForUser,
    });
    return;
  }

  personaEnrichmentInFlight.add(key);
  personaEnrichmentByUser.set(userId, inFlightForUser + 1);

  void (async () => {
    try {
      const aiDescription = await generatePersonaDescriptionWithRetry(
        userId,
        contactPhone,
        historyLimit
      );

      if (!aiDescription) {
        return;
      }

      const latestPersona = await getPersona(userId, contactPhone);
      if (!latestPersona) {
        return;
      }

      latestPersona.aiDescription = aiDescription;
      await savePersona(userId, contactPhone, latestPersona);

      logger.info("[AI] Persona description enriched asynchronously", {
        userId,
        contactPhone,
        descriptionLength: aiDescription.length,
      });
    } catch (error) {
      logger.warn("[AI] Persona async enrichment failed", {
        userId,
        contactPhone,
        error: String(error),
      });
    } finally {
      personaEnrichmentInFlight.delete(key);
      const current = personaEnrichmentByUser.get(userId) ?? 1;
      if (current <= 1) {
        personaEnrichmentByUser.delete(userId);
      } else {
        personaEnrichmentByUser.set(userId, current - 1);
      }
    }
  })();
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
  const standardMatch = input.match(/^-?r\s*-\s*(.+?)\s*-\s*(.+?)\.?$/i);
  if (!standardMatch) {
    return null;
  }

  const task = normalizeReminderTask(standardMatch[1] ?? "");
  const scheduleInput = (standardMatch[2] ?? "").trim();
  if (!task || !scheduleInput) {
    return null;
  }

  const relativeMatch = scheduleInput.match(
    /^-?(\d+)\s*(seconds?|secs?|s|minutes?|mins?|min|m|hours?|hrs?|hr|h|days?|day|d|din|ghanta|ghante)$/i
  );
  if (relativeMatch) {
    const amount = Number(relativeMatch[1] ?? "");
    const unitMs = parseReminderUnitMs((relativeMatch[2] ?? "").toLowerCase());
    if (!Number.isFinite(amount) || amount <= 0 || !unitMs) {
      return null;
    }
    return { task, scheduledAt: new Date(now.getTime() + amount * unitMs) };
  }

  const scheduledAt = parseReminderDateTime(scheduleInput, now);
  if (!scheduledAt) {
    return null;
  }

  return { task, scheduledAt };
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

function parseSpamCommandParams(
  command: CommandResult,
  fallbackMessage?: string
): SpamCommandParams {
  const rawMessage = String(command.data?.message ?? fallbackMessage ?? "").trim();
  const count = Number(command.data?.count ?? "");
  const delaySeconds = Number(command.data?.delaySeconds ?? "");

  if (!rawMessage) {
    throw new Error("Spam message cannot be empty. Add message text or reply to a text message.");
  }
  if (!Number.isFinite(count) || count < 1 || count > 100) {
    throw new Error("Spam count must be between 1 and 100.");
  }
  if (!Number.isFinite(delaySeconds) || delaySeconds < 1 || delaySeconds > 3600) {
    throw new Error("Spam delay must be between 1 and 3600 seconds.");
  }

  return {
    message: rawMessage,
    count,
    delaySeconds,
  };
}

async function waitMs(ms: number): Promise<void> {
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

async function sendRepeatedTextMessage(
  userId: string,
  jid: string,
  params: SpamCommandParams
): Promise<void> {
  const sock = getSocketFor(userId);
  for (let i = 0; i < params.count; i++) {
    await sock.sendMessage(jid, { text: params.message });
    if (i < params.count - 1) {
      await waitMs(params.delaySeconds * 1000);
    }
  }
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
export async function handleAIResponse(
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

    // ── Evaluate effective mimic state (contact override > global default) ──
    // If contact explicitly invoked the bot, bypass mimic/global checks.
    if (aiMode !== "bot" && !isMimicEnabledForContact(userId, contactPhone, aiEnabled)) {
      logger.info(`${tag} Effective mimic disabled, skipping`, { userId, aiEnabled });
      return;
    }

    if (aiMode === "bot" && quotedText) {
      promptText = `Replied message: "${quotedText}"\n\nMy question: ${promptText}`;
    }

    const reminderIntent = aiMode === "bot" ? parseReminderIntent(rawBotPrompt) : null;
    if (reminderIntent) {
      const isCommand = reminderIntent.task.trim().startsWith("!");
      const scheduledMessageText = isCommand ? reminderIntent.task.trim() : `⏰ Reminder: ${reminderIntent.task}`;
        
      const scheduled = await addScheduledMessage(
        userId,
        jid,
        scheduledMessageText,
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
        logger.info(`${tag} Requesting history backfill (have ${msgCount}, want ${BACKFILL_TARGET_MESSAGES})`, { userId });
        try {
          const sock = getSocketFor(userId);
          // fetchMessageHistory is fire-and-forget; results arrive via messages.upsert/append
          // NOTE: This method may not exist in all Baileys versions - wrapped in try/catch
          await (sock as any).fetchMessageHistory(
            BACKFILL_TARGET_MESSAGES,
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

    // ── Step 3: Ensure persona exists (only for mimic mode) ───────────────
    if (aiMode === "mimic") {
      let persona = await getPersona(userId, contactPhone);
      const personaLastUpdated = await getPersonaLastUpdated(userId, contactPhone);
      const nowMs = Date.now();
      const freshCount = msgCount;
      const refreshThreshold = getPersonaRefreshThreshold(freshCount);
      const newMessagesSinceRefresh = personaLastUpdated
        ? await getMessageCountSince(userId, contactPhone, personaLastUpdated)
        : freshCount;
      const forceRefreshByAge =
        personaLastUpdated != null && nowMs - personaLastUpdated.getTime() > PERSONA_FORCE_REFRESH_AGE_MS;
      const refreshReason = getPersonaRefreshReason({
        hasPersona: Boolean(persona),
        forceRefreshByAge,
        newMessagesSinceRefresh,
        threshold: refreshThreshold,
      });
      const shouldRefreshPersona =
        refreshReason !== "skip";

      logger.info(`${tag} Step 3: Persona refresh decision`, {
        userId,
        personaExists: Boolean(persona),
        freshCount,
        newMessagesSinceRefresh,
        refreshThreshold,
        forceRefreshByAge,
        refreshReason,
        shouldRefreshPersona,
      });

      if (shouldRefreshPersona) {
        if (freshCount >= MIN_MESSAGES_FOR_PERSONA) {
          const extractionLimit = Math.min(freshCount, PERSONA_CONTEXT_WINDOW);
          const extractionStartedAt = Date.now();
          logger.info(`${tag} Generating persona from ${extractionLimit} mutual messages`, {
            userId,
            refreshReason,
          });

          // Rule-based extraction first (fast and deterministic).
          persona = await extractPersona(userId, contactPhone, extractionLimit);

          await savePersona(userId, contactPhone, persona);
          logger.info(`${tag} Persona saved`, {
            userId,
            refreshReason,
            extractionMs: Date.now() - extractionStartedAt,
          });

          // AI voice enrichment runs asynchronously so replies are never blocked.
          if (freshCount >= MIN_MESSAGES_FOR_AI_DESCRIPTION) {
            runPersonaEnrichmentInBackground(userId, contactPhone, extractionLimit);
          }
        } else {
          logger.info(
            `${tag} Insufficient mutual history for persona refresh`,
            {
              userId,
              freshCount,
              requiredMessages: MIN_MESSAGES_FOR_PERSONA,
              refreshReason,
            }
          );
        }
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
 * Handle own-message (fromMe) commands: !me, !{botName}, !mimic, !refresh, !ai status, !me -d, !me -s.
 *
 * Flow for ALL commands:
 *   1. Immediately edits the sent command message to "⏳ Processing..."
 *   2. Download commands (!me -d ...):
 *        - Edits to "⏳ Downloading media..." while downloading
 *        - Edits to success/error text after resend
 *   3. Repeat-message commands (!me -s ...):
 *        - Edits to "⏳ Spamming..." while sending repeated messages
 *        - Edits to success/error text after completion
 *   4. AI commands (!me / !{botName}):
 *        - Edits to "⏳ Generating..." while waiting for the AI
 *        - Edits to "✅" once done, then sends the AI reply as new messages
 *   5. Settings commands (!mimic, !ai status, !refresh):
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
export async function handleOwnCommand(
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

  // ── Repeat-message command (!me -s ... -d ...) ───────────────────────────────
  if (command.type === "spam") {
    try {
      const params = parseSpamCommandParams(command, quotedText);
      await editOwnMessage(
        userId,
        jid,
        msgKey,
        `⏳ Spamming ${params.count} message(s) every ${params.delaySeconds}s...`
      );
      await sendRepeatedTextMessage(userId, jid, params);
      await editOwnMessage(userId, jid, msgKey, `✅ Sent ${params.count} message(s).`);
    } catch (e) {
      logger.error("[Command] Spam command failed", { userId, contactPhone, error: String(e) });
      await editOwnMessage(userId, jid, msgKey, `❌ ${String((e as Error)?.message || e)}`);
    }
    return;
  }

  // ── AI explain commands (!me / !{botName}) ──────────────────────────────────
  if (command.type === "explain") {
    try {
      const reminderIntent = parseReminderIntent(command.content ?? "");
      if (reminderIntent) {
        const isCommand = reminderIntent.task.trim().startsWith("!");
        const scheduledMessageText = isCommand ? reminderIntent.task.trim() : `⏰ Reminder: ${reminderIntent.task}`;
        
        const scheduled = await addScheduledMessage(
          userId,
          jid,
          scheduledMessageText,
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
