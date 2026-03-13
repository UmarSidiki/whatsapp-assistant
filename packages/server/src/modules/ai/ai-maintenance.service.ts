import { desc, eq, max, sql } from "drizzle-orm";
import { db } from "../../database";
import { aiChatHistory, aiPersona } from "../../database/schema";
import { logger } from "../../core/logger";
import { trimMessageHistoryForContact, isSystemContactId } from "./ai-assistant.service";
import { getAllSessions, toJid } from "../whatsapp/wa-socket";

const TOP_CHAT_LIMIT = 20;
const MAINTENANCE_INTERVAL_MS = 6 * 60 * 60 * 1000;

let maintenanceTimer: ReturnType<typeof setInterval> | null = null;
let maintenanceInProgress = false;

async function getTopContactsByRecency(userId: string, limitCount: number): Promise<string[]> {
  const rows = await db
    .select({
      contactPhone: aiChatHistory.contactPhone,
      lastTs: max(aiChatHistory.timestamp),
    })
    .from(aiChatHistory)
    .where(eq(aiChatHistory.userId, userId))
    .groupBy(aiChatHistory.contactPhone)
    .orderBy(desc(max(aiChatHistory.timestamp)))
    .limit(limitCount);

  return rows
    .map((row) => row.contactPhone)
    .filter((contactPhone) => !isSystemContactId(contactPhone));
}

async function pruneUnusedChatsForUser(userId: string, topContacts: string[]): Promise<void> {
  if (topContacts.length === 0) {
    return;
  }

  const placeholders = sql.join(topContacts.map((contact) => sql`${contact}`), sql`, `);

  await db.delete(aiChatHistory).where(sql`
    ${aiChatHistory.userId} = ${userId}
    AND ${aiChatHistory.contactPhone} NOT IN (${placeholders})
  `);

  await db.delete(aiPersona).where(sql`
    ${aiPersona.userId} = ${userId}
    AND ${aiPersona.contactPhone} NOT IN (${placeholders})
  `);
}

async function refreshTopContactData(userId: string, topContacts: string[]): Promise<void> {
  const session = getAllSessions().get(userId);
  const socket = session?.socket as any;

  for (const contactPhone of topContacts) {
    try {
      // Keep per-contact history bounded for hot contacts.
      await trimMessageHistoryForContact(userId, contactPhone);

      // Best-effort history fetch from WhatsApp to keep latest context in DB.
      if (socket) {
        try {
          await socket.fetchMessageHistory(
            100,
            { remoteJid: toJid(contactPhone), fromMe: false, id: "" },
            0
          );
        } catch (fetchError) {
          logger.debug("AI maintenance: fetchMessageHistory skipped", {
            userId,
            contactPhone,
            error: String(fetchError),
          });
        }
      }
    } catch (error) {
      logger.warn("AI maintenance: failed for contact", {
        userId,
        contactPhone,
        error: String(error),
      });
    }
  }
}

async function getUsersWithAIHistory(): Promise<string[]> {
  const historyUsers = await db
    .selectDistinct({ userId: aiChatHistory.userId })
    .from(aiChatHistory);

  const users = new Set<string>();
  for (const row of historyUsers) {
    if (row.userId) {
      users.add(row.userId);
    }
  }

  getAllSessions().forEach((_state, userId) => {
    users.add(userId);
  });

  return Array.from(users);
}

export async function runAIMaintenanceCycle(): Promise<void> {
  if (maintenanceInProgress) {
    logger.info("AI maintenance: previous cycle still running, skipping");
    return;
  }

  maintenanceInProgress = true;
  const startedAt = Date.now();

  try {
    const users = await getUsersWithAIHistory();
    if (users.length === 0) {
      return;
    }

    for (const userId of users) {
      try {
        const topContacts = await getTopContactsByRecency(userId, TOP_CHAT_LIMIT);
        if (topContacts.length === 0) {
          continue;
        }

        await pruneUnusedChatsForUser(userId, topContacts);
        await refreshTopContactData(userId, topContacts);

        logger.info("AI maintenance: user cycle complete", {
          userId,
          topContacts: topContacts.length,
        });
      } catch (userError) {
        logger.warn("AI maintenance: user cycle failed", {
          userId,
          error: String(userError),
        });
      }
    }
  } catch (error) {
    logger.error("AI maintenance: cycle failed", { error: String(error) });
  } finally {
    maintenanceInProgress = false;
    logger.info("AI maintenance: cycle finished", {
      durationMs: Date.now() - startedAt,
    });
  }
}

export function startAIMaintenanceScheduler(): void {
  if (maintenanceTimer) {
    return;
  }

  maintenanceTimer = setInterval(() => {
    runAIMaintenanceCycle().catch((error) => {
      logger.error("AI maintenance: scheduled cycle failed", { error: String(error) });
    });
  }, MAINTENANCE_INTERVAL_MS);

  maintenanceTimer.unref?.();
  logger.info("AI maintenance scheduler started", {
    intervalHours: MAINTENANCE_INTERVAL_MS / (60 * 60 * 1000),
    topChatLimit: TOP_CHAT_LIMIT,
  });
}
