import { logger } from "../lib/logger";
import { toJid, ServiceError } from "./wa-socket";
import { sendSegmented } from "./segment.service";
import { getSession } from "./wa-socket";
import { db } from "../db";
import { scheduledMessage, messageLog } from "../db/schema";
import { eq, and } from "drizzle-orm";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ScheduledMessage {
  id: string;
  phone: string;
  message: string;
  scheduledAt: string; // ISO 8601
  status: "pending" | "sent" | "failed";
}

// In-memory timers (re-populated on startup)
const timers = new Map<string, ReturnType<typeof setTimeout>>();

// ─── Schedule ─────────────────────────────────────────────────────────────────

/** Return all scheduled messages for a user from DB. */
export async function getScheduledMessages(userId: string): Promise<ScheduledMessage[]> {
  const rows = await db.select().from(scheduledMessage)
    .where(eq(scheduledMessage.userId, userId))
    .all();
  return rows.map(r => ({
    id: r.id,
    phone: r.phone,
    message: r.message,
    scheduledAt: new Date(r.scheduledAt).toISOString(),
    status: r.status,
  })) as ScheduledMessage[];
}

/** Add a message to the schedule, persist to DB, and set a send timer. */
export async function addScheduledMessage(
  userId: string,
  phone: string,
  message: string,
  scheduledAt: string
): Promise<ScheduledMessage> {
  const id = crypto.randomUUID();
  const now = new Date();
  await db.insert(scheduledMessage).values({
    id,
    userId,
    phone,
    message,
    scheduledAt: new Date(scheduledAt),
    status: "pending",
    createdAt: now,
  });
  const msg: ScheduledMessage = { id, phone, message, scheduledAt, status: "pending" };
  dispatchScheduled(userId, msg);
  return msg;
}

/** Cancel a pending scheduled message. Throws 404 if not found. */
export async function cancelScheduledMessage(userId: string, id: string): Promise<void> {
  const [existing] = await db.select().from(scheduledMessage)
    .where(and(eq(scheduledMessage.id, id), eq(scheduledMessage.userId, userId)));
  if (!existing) throw new ServiceError("Scheduled message not found", 404);
  const timer = timers.get(id);
  if (timer) { clearTimeout(timer); timers.delete(id); }
  await db.delete(scheduledMessage).where(eq(scheduledMessage.id, id));
}

/** Re-arm timers for all pending messages (call once on server startup). */
export async function restoreScheduledMessages(): Promise<void> {
  const rows = await db.select().from(scheduledMessage)
    .where(eq(scheduledMessage.status, "pending"))
    .all();
  for (const row of rows) {
    const msg: ScheduledMessage = {
      id: row.id,
      phone: row.phone,
      message: row.message,
      scheduledAt: new Date(row.scheduledAt).toISOString(),
      status: "pending",
    };
    dispatchScheduled(row.userId ?? "", msg);
  }
  logger.info(`Restored ${rows.length} scheduled messages`);
}

// ─── Internal ─────────────────────────────────────────────────────────────────

function dispatchScheduled(userId: string, msg: ScheduledMessage): void {
  const delay = new Date(msg.scheduledAt).getTime() - Date.now();

  const run = async () => {
    timers.delete(msg.id);
    const session = getSession(userId);
    if (!session.socket || session.status !== "connected") {
      await db.update(scheduledMessage).set({ status: "failed" }).where(eq(scheduledMessage.id, msg.id));
      await logMessage(userId, "scheduled", msg.phone, msg.message, "failed", "Not connected");
      logger.warn("Scheduled message failed — not connected", { userId, id: msg.id });
      return;
    }
    try {
      await sendSegmented(userId, toJid(msg.phone), msg.message);
      await db.update(scheduledMessage).set({ status: "sent" }).where(eq(scheduledMessage.id, msg.id));
      await logMessage(userId, "scheduled", msg.phone, msg.message, "sent");
      logger.info("Scheduled message sent", { userId, id: msg.id });
    } catch (e) {
      await db.update(scheduledMessage).set({ status: "failed" }).where(eq(scheduledMessage.id, msg.id));
      await logMessage(userId, "scheduled", msg.phone, msg.message, "failed", String(e));
      logger.error("Scheduled message failed", { userId, id: msg.id, error: String(e) });
    }
  };

  if (delay <= 0) run();
  else timers.set(msg.id, setTimeout(run, delay));
}

async function logMessage(
  userId: string,
  type: "single" | "bulk" | "scheduled" | "auto_reply",
  phone: string,
  message: string,
  status: "sent" | "failed",
  error?: string
) {
  await db.insert(messageLog).values({
    id: crypto.randomUUID(),
    userId,
    type,
    phone,
    message,
    status,
    error: error ?? null,
    createdAt: new Date(),
  });
}
