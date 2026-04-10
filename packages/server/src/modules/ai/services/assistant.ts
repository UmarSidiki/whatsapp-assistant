import { createHash } from "node:crypto";
import { eq, and, desc, sql, max, gt } from "drizzle-orm";
import { db } from "../../../database";
import { waChatMessage } from "../../../database";
import { logger } from "../../../core/logger";
import { normalizeContactId } from "../../whatsapp/services";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MessageHistoryItem {
  message: string;
  sender: "me" | "contact";
  timestamp: Date;
}

const MAX_MESSAGES_PER_CONTACT = 1000;
const SYSTEM_CONTACT_IDS = new Set(["me", "contact", "ai", "assistant", "user"]);

interface StoreMessageOptions {
  skipTrim?: boolean;
}

function normalizeStoredSender(sender: string): "me" | "contact" {
  return sender === "me" ? "me" : "contact";
}

function toDirectJid(contactPhone: string): string {
  return `${contactPhone}@s.whatsapp.net`;
}

function buildAssistantDedupeKey(input: {
  chatId: string;
  sender: "me" | "contact";
  timestamp: Date;
  message: string;
}): string {
  const fingerprint = `${input.chatId}|${input.sender}|${input.timestamp.toISOString()}|${input.message}`;
  return `assistant:${createHash("sha1").update(fingerprint).digest("hex")}`;
}

/**
 * Legacy/invalid buckets (e.g. "ai", "contact") can exist from older builds.
 * Treat these as system IDs so dashboard/persona APIs only show real contacts.
 */
export function isSystemContactId(contactPhone: string): boolean {
  const normalized = normalizeContactId(contactPhone);
  if (!normalized) return true;
  return SYSTEM_CONTACT_IDS.has(normalized);
}

// ─── Storage ──────────────────────────────────────────────────────────────────

/**
 * Store a message in chat history (both incoming and outgoing)
 */
export async function storeMessage(
  userId: string,
  contactPhone: string,
  message: string,
  sender: "me" | "contact",
  timestamp?: Date,
  options?: StoreMessageOptions
): Promise<void> {
  if (!contactPhone || !message.trim()) {
    return;
  }

  // Normalize phone/LID identifier for stable storage
  const normalizedPhone = normalizeContactId(contactPhone);
  if (!normalizedPhone) {
    logger.warn("AI assistant: Invalid contact identifier", { contactPhone });
    return;
  }
  if (isSystemContactId(normalizedPhone)) {
    logger.warn("AI assistant: Skipping system contact identifier", {
      userId,
      contactPhone: normalizedPhone,
    });
    return;
  }

  try {
    const ts = timestamp ?? new Date();
    const chatId = toDirectJid(normalizedPhone);
    const dedupeKey = buildAssistantDedupeKey({
      chatId,
      sender,
      timestamp: ts,
      message: message.trim(),
    });

    await db
      .insert(waChatMessage)
      .values({
        id: crypto.randomUUID(),
        userId,
        chatId,
        chatType: "direct",
        contactPhone: normalizedPhone,
        title: normalizedPhone,
        message: message.trim(),
        sender,
        waMessageId: null,
        dedupeKey,
        source: "api",
        timestamp: ts,
        createdAt: new Date(),
      })
      .onConflictDoNothing({
        target: [waChatMessage.userId, waChatMessage.dedupeKey],
      });
  } catch (e) {
    logger.warn("AI assistant: Failed to store message", {
      error: String(e),
      userId,
      contactPhone,
    });
    return;
  }

  if (!options?.skipTrim) {
    try {
      await trimMessageHistoryForContact(userId, normalizedPhone);
    } catch (e) {
      logger.warn("AI assistant: Failed to trim message history", {
        error: String(e),
        userId,
        contactPhone: normalizedPhone,
      });
    }
  }
}

/**
 * Keep only the newest MAX_MESSAGES_PER_CONTACT messages for one user-contact pair.
 */
export async function trimMessageHistoryForContact(
  userId: string,
  contactPhone: string
): Promise<void> {
  await db.delete(waChatMessage).where(sql`
    ${waChatMessage.userId} = ${userId}
    AND ${waChatMessage.chatType} = 'direct'
    AND ${waChatMessage.contactPhone} = ${contactPhone}
    AND ${waChatMessage.id} IN (
      SELECT id
      FROM wa_chat_message
      WHERE userId = ${userId}
        AND "chatType" = 'direct'
        AND contactPhone = ${contactPhone}
      ORDER BY timestamp DESC, id DESC
      LIMIT -1 OFFSET ${MAX_MESSAGES_PER_CONTACT}
    )
  `);
}

// ─── Retrieval ────────────────────────────────────────────────────────────────

/**
 * Retrieve last N messages for a contact (for context)
 */
export async function getMessageHistory(
  userId: string,
  contactPhone: string,
  limit_n: number = 50
): Promise<MessageHistoryItem[]> {
  const normalizedPhone = normalizeContactId(contactPhone);

  try {
    const messages = await db
      .select({
        message: waChatMessage.message,
        sender: waChatMessage.sender,
        timestamp: waChatMessage.timestamp,
      })
      .from(waChatMessage)
      .where(
        and(
          eq(waChatMessage.userId, userId),
          eq(waChatMessage.chatType, "direct"),
          eq(waChatMessage.contactPhone, normalizedPhone)
        )
      )
      .orderBy(desc(waChatMessage.timestamp), desc(waChatMessage.id))
      .limit(limit_n);

    // Reverse to get chronological order
    return messages
      .map((msg) => ({
        message: msg.message,
        sender: normalizeStoredSender(String(msg.sender)),
        timestamp: msg.timestamp,
      }))
      .reverse();
  } catch (e) {
    logger.error("AI assistant: Failed to retrieve message history", {
      error: String(e),
      userId,
      contactPhone: normalizedPhone,
    });
    return [];
  }
}

/**
 * Get message count for a contact
 */
export async function getMessageCount(
  userId: string,
  contactPhone: string
): Promise<number> {
  const normalizedPhone = normalizeContactId(contactPhone);

  try {
    const result = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(waChatMessage)
      .where(
        and(
          eq(waChatMessage.userId, userId),
          eq(waChatMessage.chatType, "direct"),
          eq(waChatMessage.contactPhone, normalizedPhone)
        )
      );

    return result[0]?.count || 0;
  } catch (e) {
    logger.error("AI assistant: Failed to get message count", {
      error: String(e),
      userId,
      contactPhone: normalizedPhone,
    });
    return 0;
  }
}

/**
 * Count direct mutual messages for one contact since a given timestamp.
 */
export async function getMessageCountSince(
  userId: string,
  contactPhone: string,
  since: Date
): Promise<number> {
  const normalizedPhone = normalizeContactId(contactPhone);

  try {
    const result = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(waChatMessage)
      .where(
        and(
          eq(waChatMessage.userId, userId),
          eq(waChatMessage.chatType, "direct"),
          eq(waChatMessage.contactPhone, normalizedPhone),
          gt(waChatMessage.timestamp, since)
        )
      );

    return result[0]?.count || 0;
  } catch (e) {
    logger.error("AI assistant: Failed to get message count since timestamp", {
      error: String(e),
      userId,
      contactPhone: normalizedPhone,
      since: since.toISOString(),
    });
    return 0;
  }
}

/**
 * Get all unique contacts for a user
 */
export async function getContacts(userId: string): Promise<string[]> {
  try {
    // Get top 20 contacts by most recent message
    const result = await db
      .select({
        contactPhone: waChatMessage.contactPhone,
      })
      .from(waChatMessage)
      .where(
        and(
          eq(waChatMessage.userId, userId),
          eq(waChatMessage.chatType, "direct"),
          sql`${waChatMessage.contactPhone} IS NOT NULL`
        )
      )
      .groupBy(waChatMessage.contactPhone)
      .orderBy(desc(max(waChatMessage.timestamp)))
      .limit(20);

    return result
      .map((r) => r.contactPhone)
      .filter((contactPhone): contactPhone is string => Boolean(contactPhone) && !isSystemContactId(contactPhone));
  } catch (e) {
    logger.error("AI assistant: Failed to retrieve contacts", {
      error: String(e),
      userId,
    });
    return [];
  }
}

// ─── Sync ─────────────────────────────────────────────────────────────────────

/**
 * Sync old messages from WhatsApp (if available)
 * Note: This would typically sync from WhatsApp's local history
 * For now, this is a placeholder that returns 0 synced
 */
export async function syncOldMessages(userId: string): Promise<number> {
  logger.info("AI assistant: Sync old messages requested", { userId });

  // TODO: Implement syncing from WhatsApp local message store when needed
  // For now, just return 0 as we're capturing messages in real-time
  return 0;
}

// ─── Cleanup ──────────────────────────────────────────────────────────────────

/**
 * Cleanup old messages - keep only last 1000 per contact
 */
export async function cleanupOldMessages(userId: string): Promise<void> {
  try {
    // Get all contacts for this user
    const contacts = await getContacts(userId);

    for (const contactPhone of contacts) {
      try {
        await trimMessageHistoryForContact(userId, contactPhone);
      } catch (e) {
        logger.warn("AI assistant: Failed to cleanup messages for contact", {
          error: String(e),
          userId,
          contactPhone,
        });
      }
    }
  } catch (e) {
    logger.error("AI assistant: Failed to cleanup old messages", {
      error: String(e),
      userId,
    });
  }
}
