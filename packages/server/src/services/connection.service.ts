import makeWASocket, {
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
} from "@whiskeysockets/baileys";
import pino from "pino";
import { existsSync, readdirSync } from "fs";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger";
import {
  getSession,
  setSession,
  removeSession,
  isIndividualJid,
  getSocketFor,
} from "./wa-socket";
import { handleAutoReply } from "./autoreply.service";
import { storeMessage, getMessageCount, getMessageHistory } from "./ai-assistant.service";
import { parseCommand, executeCommand, isMimicEnabledForContact } from "./message-handler.service";
import { generateResponse, generatePersonaAIDescription } from "./ai-response.service";
import { getPersona, extractPersona, savePersona } from "./ai-persona.service";
import { bufferIncomingMessage, sendSegmented, sendSegments } from "./segment.service";
import { db } from "../db";
import { aiSettings, messageLog } from "../db/schema";

// ─── Per-user auth directory ──────────────────────────────────────────────────

const WA_AUTH_ROOT = "./wa-auth";

function authDir(userId: string): string {
  return `${WA_AUTH_ROOT}/${userId}`;
}

// Track contacts whose history backfill has already been requested
const backfilledContacts = new Set<string>();

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
    syncFullHistory: true,
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

  // ── Store bulk history from initial sync ─────────────────────────────────
  sock.ev.on("messaging-history.set" as any, async (data: any) => {
    const historyMessages = data?.messages;
    if (!Array.isArray(historyMessages) || historyMessages.length === 0) return;

    logger.info("[History Sync] Received bulk history", {
      userId,
      messageCount: historyMessages.length,
    });

    let stored = 0;
    for (const msg of historyMessages) {
      try {
        const jid = msg.key?.remoteJid ?? "";
        if (!isIndividualJid(jid)) continue;

        const text =
          msg.message?.conversation ||
          msg.message?.extendedTextMessage?.text ||
          "";
        if (!text) continue;

        const contactPhone = jid.replace("@s.whatsapp.net", "");
        const sender = msg.key.fromMe ? "me" : "contact";
        const ts = msg.messageTimestamp
          ? new Date(Number(msg.messageTimestamp) * 1000)
          : new Date();

        await storeMessage(userId, contactPhone, text, sender, ts);
        stored++;
      } catch {
        // best-effort — skip individual message failures
      }
    }

    logger.info("[History Sync] Stored bulk history messages", {
      userId,
      storedCount: stored,
    });
  });

  // ── Route ALL messages.upsert events ─────────────────────────────────────
  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    logger.info("[Message Upsert] Event", { userId, type, count: messages.length });

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
          // Extract replied-to message text so !me/!{name} can reference it even
          // when the quoted message is not yet in the context database.
          const ctxInfo = msg.message?.extendedTextMessage?.contextInfo;
          const quotedText =
            ctxInfo?.quotedMessage?.conversation ||
            ctxInfo?.quotedMessage?.extendedTextMessage?.text ||
            undefined;

          handleOwnCommand(userId, jid, contactPhone, text, msg.key, quotedText).catch((e) =>
            logger.error("Own command handler failed", {
              userId,
              jid,
              error: String(e),
            })
          );
        }
      } else {
        // Buffer rapid incoming messages, then run the full AI flow
        const bufferKey = `${userId}_${contactPhone}`;
        bufferIncomingMessage(bufferKey, text, async (combinedText) => {
          // Auto-reply takes priority — skip AI if a rule matched
          const autoReplied = await handleAutoReply(userId, jid, combinedText);
          if (!autoReplied) {
            await handleAIResponse(userId, jid, contactPhone, combinedText);
          }
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
  text: string
): Promise<void> {
  const tag = `[AI ${contactPhone}]`;

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

    if (!aiEnabled) {
      logger.info(`${tag} AI is disabled globally, skipping`, { userId });
      return;
    }

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

    // ── Check per-contact mimic toggle ────────────────────────────────────
    // Default is enabled (opt-out model). Only skip if explicitly turned off via !mimic off.
    // If contact explicitly invoked the bot, bypass the mimic check
    if (!isMimicEnabledForContact(userId, contactPhone) && aiMode !== "bot") {
      logger.info(`${tag} Mimic disabled for this contact, skipping`, { userId });
      return;
    }

    logger.info(`${tag} AI is enabled`, { userId });

    // ── Step 2: Check message count & request backfill ────────────────────
    const msgCount = await getMessageCount(userId, contactPhone);
    logger.info(`${tag} Step 2: Message count = ${msgCount}`, { userId });

    if (msgCount < 500) {
      const backfillKey = `${userId}_${contactPhone}`;
      if (!backfilledContacts.has(backfillKey)) {
        backfilledContacts.add(backfillKey);
        logger.info(`${tag} Requesting history backfill (have ${msgCount}, want 500)`, { userId });
        try {
          const sock = getSocketFor(userId);
          // fetchMessageHistory is fire-and-forget; results arrive via messages.upsert/append
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
 * Handle own-message (fromMe) commands: !me, !{botName}, !mimic, !refresh, !ai status.
 *
 * Flow for ALL commands:
 *   1. Immediately edits the sent command message to "⏳ Processing..."
 *   2. AI commands (!me / !{botName}):
 *        - Edits to "⏳ Generating..." while waiting for the AI
 *        - Edits to "✅" once done, then sends the AI reply as new messages
 *   3. Settings commands (!mimic, !ai status, !refresh):
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
  quotedText?: string
): Promise<void> {
  // Immediately show a processing indicator in the sent message
  await editOwnMessage(userId, jid, msgKey, "⏳ Processing...");

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
  if (!command.type) {
    // Not a recognised command — restore the original text
    await editOwnMessage(userId, jid, msgKey, text);
    return;
  }

  // ── AI explain commands (!me / !{botName}) ──────────────────────────────────
  if (command.type === "explain") {
    await editOwnMessage(userId, jid, msgKey, "⏳ Generating...");
    try {
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
