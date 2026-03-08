import { db } from "../../database";
import { messageLog, autoReplyRule, scheduledMessage, template } from "../../database/schema";
import { eq, gte, and, count, sql } from "drizzle-orm";

// ─── Stats ────────────────────────────────────────────────────────────────────

export interface Stats {
  totalSent: number;
  totalFailed: number;
  sentToday: number;
  failedToday: number;
  /** Last 7 days of daily sent counts (oldest first) */
  dailyActivity: Array<{ date: string; sent: number; failed: number }>;
  scheduledPending: number;
  autoReplyRules: number;
  templates: number;
}

/** Return dashboard statistics for a specific user. */
export async function getStats(userId: string): Promise<Stats> {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const userFilter = userId
    ? sql`AND ${messageLog.userId} = ${userId}`
    : sql``;

  // Aggregate totals from message_log
  const [totals] = await db
    .select({
      totalSent: sql<number>`SUM(CASE WHEN status='sent' THEN 1 ELSE 0 END)`,
      totalFailed: sql<number>`SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END)`,
      sentToday: sql<number>`SUM(CASE WHEN status='sent' AND createdAt >= ${startOfToday.getTime()} THEN 1 ELSE 0 END)`,
      failedToday: sql<number>`SUM(CASE WHEN status='failed' AND createdAt >= ${startOfToday.getTime()} THEN 1 ELSE 0 END)`,
    })
    .from(messageLog)
    .where(eq(messageLog.userId, userId));

  // Last 7 days daily activity
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  sevenDaysAgo.setHours(0, 0, 0, 0);

  const recentLogs = await db
    .select({ status: messageLog.status, createdAt: messageLog.createdAt })
    .from(messageLog)
    .where(and(eq(messageLog.userId, userId), gte(messageLog.createdAt, sevenDaysAgo)))
    .all();

  // Group by day
  const dayMap = new Map<string, { sent: number; failed: number }>();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
    const key = d.toISOString().slice(0, 10);
    dayMap.set(key, { sent: 0, failed: 0 });
  }
  for (const log of recentLogs) {
    const key = new Date(log.createdAt).toISOString().slice(0, 10);
    const day = dayMap.get(key);
    if (day) {
      if (log.status === "sent") day.sent++;
      else day.failed++;
    }
  }
  const dailyActivity = Array.from(dayMap.entries()).map(([date, counts]) => ({
    date,
    ...counts,
  }));

  const [{ pending }] = await db
    .select({ pending: count() })
    .from(scheduledMessage)
    .where(and(eq(scheduledMessage.status, "pending"), eq(scheduledMessage.userId, userId)));

  const [{ rules }] = await db
    .select({ rules: count() })
    .from(autoReplyRule)
    .where(eq(autoReplyRule.userId, userId));

  const [{ tpl }] = await db
    .select({ tpl: count() })
    .from(template)
    .where(eq(template.userId, userId));

  return {
    totalSent: totals?.totalSent ?? 0,
    totalFailed: totals?.totalFailed ?? 0,
    sentToday: totals?.sentToday ?? 0,
    failedToday: totals?.failedToday ?? 0,
    dailyActivity,
    scheduledPending: pending,
    autoReplyRules: rules,
    templates: tpl,
  };
}
