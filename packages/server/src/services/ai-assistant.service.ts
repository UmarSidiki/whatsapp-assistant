import { eq, and, desc, sql } from "drizzle-orm";
import { db } from "../db";
import { aiChatHistory } from "../db/schema";
import { logger } from "../lib/logger";
import { normalizeContactId } from "./wa-socket";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MessageHistoryItem {
  message: string;
  sender: "me" | "contact";
  timestamp: Date;
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
  timestamp?: Date
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

  try {
    await db.insert(aiChatHistory).values({
      id: crypto.randomUUID(),
      userId,
      contactPhone: normalizedPhone,
      message: message.trim(),
      sender,
      isOutgoing: sender === "me",
      timestamp: timestamp ?? new Date(),
    });
  } catch (e) {
    logger.warn("AI assistant: Failed to store message", {
      error: String(e),
      userId,
      contactPhone,
    });
  }
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
        message: aiChatHistory.message,
        sender: aiChatHistory.sender,
        timestamp: aiChatHistory.timestamp,
      })
      .from(aiChatHistory)
      .where(
        and(
          eq(aiChatHistory.userId, userId),
          eq(aiChatHistory.contactPhone, normalizedPhone)
        )
      )
      .orderBy(desc(aiChatHistory.timestamp))
      .limit(limit_n);

    // Reverse to get chronological order
    return messages.reverse();
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
      .from(aiChatHistory)
      .where(
        and(
          eq(aiChatHistory.userId, userId),
          eq(aiChatHistory.contactPhone, normalizedPhone)
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
 * Get all unique contacts for a user
 */
export async function getContacts(userId: string): Promise<string[]> {
  try {
    const result = await db
      .selectDistinct({
        contactPhone: aiChatHistory.contactPhone,
      })
      .from(aiChatHistory)
      .where(eq(aiChatHistory.userId, userId));

    return result.map((r) => r.contactPhone);
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
 * Cleanup old messages - keep only last 500 per contact
 */
export async function cleanupOldMessages(userId: string): Promise<void> {
  const MAX_MESSAGES_PER_CONTACT = 500;

  try {
    // Get all contacts for this user
    const contacts = await getContacts(userId);

    for (const contactPhone of contacts) {
      try {
        // Count total messages for this contact
        const countResult = await db
          .select({ count: sql<number>`COUNT(*)` })
          .from(aiChatHistory)
          .where(
            and(
              eq(aiChatHistory.userId, userId),
              eq(aiChatHistory.contactPhone, contactPhone)
            )
          );

        const totalCount = countResult[0]?.count || 0;

        if (totalCount > MAX_MESSAGES_PER_CONTACT) {
          // Get oldest messages to delete
          const messagesToDelete = await db
            .select({ id: aiChatHistory.id })
            .from(aiChatHistory)
            .where(
              and(
                eq(aiChatHistory.userId, userId),
                eq(aiChatHistory.contactPhone, contactPhone)
              )
            )
            .orderBy(aiChatHistory.timestamp)
            .limit(totalCount - MAX_MESSAGES_PER_CONTACT);

          const idsToDelete = messagesToDelete.map((m) => m.id);

          // Delete old messages
          if (idsToDelete.length > 0) {
            await db
              .delete(aiChatHistory)
              .where(sql`${aiChatHistory.id} IN (${sql.join(idsToDelete)})`);

            logger.info("AI assistant: Cleaned up old messages", {
              userId,
              contactPhone,
              deletedCount: idsToDelete.length,
            });
          }
        }
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
