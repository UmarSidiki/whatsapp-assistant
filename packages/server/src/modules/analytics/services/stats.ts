import { db } from "../../../database";
import { messageLog, autoReplyRule, scheduledMessage, template } from "../../../database";
import { eq, and, count, sql } from "drizzle-orm";

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

const STATS_CACHE_TTL_MS = 5_000;
const DAY_MS = 24 * 60 * 60 * 1000;
const statsCache = new Map<string, { value: Stats; expiresAt: number }>();

/** Return dashboard statistics for a specific user. */
export async function getStats(userId: string): Promise<Stats> {
  const nowMs = Date.now();
  const cached = statsCache.get(userId);
  if (cached && cached.expiresAt > nowMs) {
    return cached.value;
  }

  const now = new Date();
  const startOfToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const sevenDaysAgo = new Date(startOfToday.getTime() - (6 * DAY_MS));
  const startOfTodayIso = startOfToday.toISOString();
  const sevenDaysAgoIso = sevenDaysAgo.toISOString();
  const dateExpr = sql<string>`to_char(${messageLog.createdAt} at time zone 'UTC', 'YYYY-MM-DD')`;

  const [totals, recentDaily, pendingResult, rulesResult, templateResult] = await Promise.all([
    db
      .select({
        totalSent: sql<number>`COALESCE(SUM(CASE WHEN ${messageLog.status} = 'sent' THEN 1 ELSE 0 END), 0)`,
        totalFailed: sql<number>`COALESCE(SUM(CASE WHEN ${messageLog.status} = 'failed' THEN 1 ELSE 0 END), 0)`,
        sentToday: sql<number>`COALESCE(SUM(CASE WHEN ${messageLog.status} = 'sent' AND ${messageLog.createdAt} >= ${startOfTodayIso} THEN 1 ELSE 0 END), 0)`,
        failedToday: sql<number>`COALESCE(SUM(CASE WHEN ${messageLog.status} = 'failed' AND ${messageLog.createdAt} >= ${startOfTodayIso} THEN 1 ELSE 0 END), 0)`,
      })
      .from(messageLog)
      .where(eq(messageLog.userId, userId))
      .then((rows) => rows[0]),
    db
      .select({
        date: dateExpr,
        sent: sql<number>`COALESCE(SUM(CASE WHEN ${messageLog.status} = 'sent' THEN 1 ELSE 0 END), 0)`,
        failed: sql<number>`COALESCE(SUM(CASE WHEN ${messageLog.status} = 'failed' THEN 1 ELSE 0 END), 0)`,
      })
      .from(messageLog)
      .where(and(
        eq(messageLog.userId, userId),
        sql`${messageLog.createdAt} >= ${sevenDaysAgoIso}`,
      ))
      .groupBy(dateExpr)
      .orderBy(dateExpr),
    db
      .select({ pending: count() })
      .from(scheduledMessage)
      .where(and(eq(scheduledMessage.status, "pending"), eq(scheduledMessage.userId, userId)))
      .then((rows) => rows[0]),
    db
      .select({ rules: count() })
      .from(autoReplyRule)
      .where(eq(autoReplyRule.userId, userId))
      .then((rows) => rows[0]),
    db
      .select({ tpl: count() })
      .from(template)
      .where(eq(template.userId, userId))
      .then((rows) => rows[0]),
  ]);

  const dayMap = new Map<string, { sent: number; failed: number }>();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(startOfToday.getTime() - (i * DAY_MS));
    const key = d.toISOString().slice(0, 10);
    dayMap.set(key, { sent: 0, failed: 0 });
  }
  for (const row of recentDaily) {
    if (!row.date || !dayMap.has(row.date)) continue;
    dayMap.set(row.date, {
      sent: Number(row.sent ?? 0),
      failed: Number(row.failed ?? 0),
    });
  }

  const dailyActivity = Array.from(dayMap.entries()).map(([date, counts]) => ({
    date,
    ...counts,
  }));

  const stats: Stats = {
    totalSent: Number(totals?.totalSent ?? 0),
    totalFailed: Number(totals?.totalFailed ?? 0),
    sentToday: Number(totals?.sentToday ?? 0),
    failedToday: Number(totals?.failedToday ?? 0),
    dailyActivity,
    scheduledPending: pendingResult?.pending ?? 0,
    autoReplyRules: rulesResult?.rules ?? 0,
    templates: templateResult?.tpl ?? 0,
  };

  statsCache.set(userId, { value: stats, expiresAt: nowMs + STATS_CACHE_TTL_MS });
  return stats;
}
