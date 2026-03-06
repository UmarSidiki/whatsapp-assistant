import { eq, and, desc, limit, sql } from "drizzle-orm";
import { db } from "../db";
import { aiChatHistory } from "../db/schema";
import { wa, isIndividualJid } from "./wa-socket";
import { logger } from "../lib/logger";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MessageHistoryItem {
  message: string;
  sender: "me" | "contact";
  timestamp: Date;
}

// ─── Initialization ───────────────────────────────────────────────────────────

/**
 * Initialize AI message listener - hook into WhatsApp socket events
 * Call this once during app startup
 */
export async function initializeAIListener(userId: string): Promise<void> {
  if (!wa.socket) {
    logger.warn("AI listener: WhatsApp socket not initialized yet");
    return;
  }

  logger.info("AI listener initializing", { userId });

  // Hook into incoming messages
  wa.socket.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;

    for (const msg of messages) {
      const jid = msg.key.remoteJid ?? "";

      // Only store messages from individual contacts
      if (!isIndividualJid(jid)) continue;

      // Extract contact phone from JID
      const contactPhone = jid.replace("@s.whatsapp.net", "");

      // Get message text
      const text =
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        "";

      // Skip empty messages
      if (!text.trim()) continue;

      try {
        // Store message based on direction
        await storeMessage(
          userId,
          contactPhone,
          text,
          msg.key.fromMe ? "me" : "contact"
        );
      } catch (e) {
        logger.warn("AI listener: Failed to store message", {
          error: String(e),
          jid,
        });
      }
    }
  });

  logger.info("AI listener initialized", { userId });
}

// ─── Storage ──────────────────────────────────────────────────────────────────

/**
 * Store a message in chat history (both incoming and outgoing)
 */
export async function storeMessage(
  userId: string,
  contactPhone: string,
  message: string,
  sender: "me" | "contact"
): Promise<void> {
  if (!contactPhone || !message.trim()) {
    return;
  }

  // Normalize phone number (remove non-digits)
  const normalizedPhone = contactPhone.replace(/\D/g, "");
  if (!normalizedPhone) {
    logger.warn("AI assistant: Invalid phone number", { contactPhone });
    return;
  }

  try {
    const messageId = crypto.randomUUID();
    const now = new Date();

    await db.insert(aiChatHistory).values({
      id: messageId,
      userId,
      contactPhone: normalizedPhone,
      message: message.trim(),
      sender,
      isOutgoing: sender === "me",
      timestamp: now,
    });

    logger.debug("Message stored", {
      userId,
      contactPhone: normalizedPhone,
      sender,
    });
  } catch (e) {
    // Log error but don't throw - storage failures shouldn't break message flow
    logger.warn("AI assistant: Failed to store message in database", {
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
  const normalizedPhone = contactPhone.replace(/\D/g, "");

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
