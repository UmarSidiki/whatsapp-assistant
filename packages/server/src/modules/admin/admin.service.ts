import { and, count, desc, eq, like, or, sql, type SQL } from "drizzle-orm";
import { db } from "../../database";
import {
  invoice,
  messageLog,
  subscription,
  trialUsage,
  user as userTable,
} from "../../database/schema";
import { getAllSessions, type WAStatus } from "../whatsapp/wa-socket";
import { normalizeTrialPhoneNumber } from "../../core/trial";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface AdminOverview {
  totalUsers: number;
  activeWaConnections: number;
  trialRecordsCount: number;
  sentMessages: {
    sentLast24h: number;
    sentLast7d: number;
  };
  revenue: {
    totalInvoices: number;
    totalInvoiceAmount: number;
    activeSubscriptions: number;
    currency: string | null;
  };
  generatedAt: string;
}

export interface SystemHealth {
  status: "ok" | "degraded";
  generatedAt: string;
  app: {
    uptimeSeconds: number;
    memoryUsageMb: {
      rss: number;
      heapUsed: number;
    };
  };
  db: {
    status: "ok" | "down";
    latencyMs: number | null;
    totalUsers: number | null;
  };
  whatsapp: {
    activeConnections: number;
    connectedSessions: number;
  };
}

export interface TrialUsageRecord {
  id: string;
  phoneNumber: string;
  userId: string | null;
  user: {
    id: string;
    name: string | null;
    email: string | null;
    role: "user" | "admin";
  } | null;
  trialStartedAt: string;
  trialEndsAt: string;
  createdAt: string;
  isExpired: boolean;
}

export interface TrialUsageListResponse {
  trials: TrialUsageRecord[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  filters: {
    phone?: string;
    user?: string;
  };
}

export interface WhatsappOpsSnapshot {
  generatedAt: string;
  counts: {
    total: number;
    connected: number;
    waiting: number;
    disconnected: number;
    idle: number;
  };
  recentConnectionErrors: Array<{
    userId: string;
    status: WAStatus;
    lastError: string;
    lastErrorAt: string | null;
  }>;
}

function toMb(value: number): number {
  return Math.round((value / 1024 / 1024) * 10) / 10;
}

export async function getAdminOverview(): Promise<AdminOverview> {
  const nowMs = Date.now();
  const last24Hours = new Date(nowMs - DAY_MS);
  const last7Days = new Date(nowMs - (6 * DAY_MS));

  const [
    totalUsersResult,
    trialRecordsResult,
    sentLast24hResult,
    sentLast7dResult,
    revenueResult,
  ] = await Promise.all([
    db.select({ totalUsers: count() }).from(userTable).then((rows) => rows[0]),
    db.select({ trialRecords: count() }).from(trialUsage).then((rows) => rows[0]),
    db
      .select({ sentLast24h: count() })
      .from(messageLog)
      .where(andSentSince(last24Hours))
      .then((rows) => rows[0]),
    db
      .select({ sentLast7d: count() })
      .from(messageLog)
      .where(andSentSince(last7Days))
      .then((rows) => rows[0]),
    Promise.all([
      db.select({ totalInvoices: count() }).from(invoice).then((rows) => rows[0]),
      db
        .select({
          totalInvoiceAmount: sql<number>`COALESCE(SUM(${invoice.amount}), 0)`,
        })
        .from(invoice)
        .then((rows) => rows[0]),
      db.select({ activeSubscriptions: count() }).from(subscription).where(eq(subscription.status, "active")).then((rows) => rows[0]),
      db
        .select({
          currency: invoice.currency,
        })
        .from(invoice)
        .orderBy(desc(invoice.paidAt), desc(invoice.periodEnd))
        .limit(1)
        .then((rows) => rows[0]),
    ]),
  ]);

  const [revenueCounts, revenueAmount, activeSubscriptionsResult, latestInvoiceResult] = revenueResult;

  return {
    totalUsers: Number(totalUsersResult?.totalUsers ?? 0),
    activeWaConnections: getActiveWaConnections(),
    trialRecordsCount: Number(trialRecordsResult?.trialRecords ?? 0),
    sentMessages: {
      sentLast24h: Number(sentLast24hResult?.sentLast24h ?? 0),
      sentLast7d: Number(sentLast7dResult?.sentLast7d ?? 0),
    },
    revenue: {
      totalInvoices: Number(revenueCounts?.totalInvoices ?? 0),
      totalInvoiceAmount: Number(revenueAmount?.totalInvoiceAmount ?? 0),
      activeSubscriptions: Number(activeSubscriptionsResult?.activeSubscriptions ?? 0),
      currency: latestInvoiceResult?.currency ?? null,
    },
    generatedAt: new Date().toISOString(),
  };
}

export async function getSystemHealth(): Promise<SystemHealth> {
  const startedAt = Date.now();

  try {
    const [totalUsersResult] = await db.select({ totalUsers: count() }).from(userTable);
    const latencyMs = Date.now() - startedAt;
    const activeConnections = getActiveWaConnections();

    return {
      status: "ok",
      generatedAt: new Date().toISOString(),
      app: {
        uptimeSeconds: Math.floor(process.uptime()),
        memoryUsageMb: {
          rss: toMb(process.memoryUsage().rss),
          heapUsed: toMb(process.memoryUsage().heapUsed),
        },
      },
      db: {
        status: "ok",
        latencyMs,
        totalUsers: Number(totalUsersResult?.totalUsers ?? 0),
      },
      whatsapp: {
        activeConnections,
        connectedSessions: activeConnections,
      },
    };
  } catch {
    return {
      status: "degraded",
      generatedAt: new Date().toISOString(),
      app: {
        uptimeSeconds: Math.floor(process.uptime()),
        memoryUsageMb: {
          rss: toMb(process.memoryUsage().rss),
          heapUsed: toMb(process.memoryUsage().heapUsed),
        },
      },
      db: {
        status: "down",
        latencyMs: null,
        totalUsers: null,
      },
      whatsapp: {
        activeConnections: getActiveWaConnections(),
        connectedSessions: getActiveWaConnections(),
      },
    };
  }
}

export async function listTrialUsage({
  page,
  limit,
  phone,
  user,
}: {
  page: number;
  limit: number;
  phone?: string;
  user?: string;
}): Promise<TrialUsageListResponse> {
  const filters: TrialUsageListResponse["filters"] = {};
  const conditions: SQL[] = [];

  if (phone) {
    const normalizedPhone = normalizeTrialPhoneNumber(phone);
    if (normalizedPhone) {
      filters.phone = normalizedPhone;
      conditions.push(like(trialUsage.phoneNumber, `%${normalizedPhone}%`));
    }
  }

  if (user) {
    filters.user = user;
    conditions.push(
      or(
        eq(trialUsage.userId, user),
        like(userTable.id, `%${user}%`),
        like(userTable.name, `%${user}%`),
        like(userTable.email, `%${user}%`),
      )!,
    );
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
  const offset = (page - 1) * limit;

  const [countRow, rows] = await Promise.all([
    db
      .select({ total: count() })
      .from(trialUsage)
      .leftJoin(userTable, eq(trialUsage.userId, userTable.id))
      .where(whereClause)
      .then((result) => result[0]),
    db
      .select({
        id: trialUsage.id,
        phoneNumber: trialUsage.phoneNumber,
        userId: trialUsage.userId,
        trialStartedAt: trialUsage.trialStartedAt,
        trialEndsAt: trialUsage.trialEndsAt,
        createdAt: trialUsage.createdAt,
        user: {
          id: userTable.id,
          name: userTable.name,
          email: userTable.email,
          role: userTable.role,
        },
      })
      .from(trialUsage)
      .leftJoin(userTable, eq(trialUsage.userId, userTable.id))
      .where(whereClause)
      .orderBy(desc(trialUsage.createdAt))
      .limit(limit)
      .offset(offset),
  ]);

  const total = Number(countRow?.total ?? 0);

  return {
    trials: rows.map((row) => ({
      id: row.id,
      phoneNumber: row.phoneNumber,
      userId: row.userId,
      user: row.user?.id
        ? {
            id: row.user.id,
            name: row.user.name ?? null,
            email: row.user.email ?? null,
            role: row.user.role,
          }
        : null,
      trialStartedAt: row.trialStartedAt.toISOString(),
      trialEndsAt: row.trialEndsAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
      isExpired: row.trialEndsAt.getTime() < Date.now(),
    })),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
    filters,
  };
}

export async function getWhatsappOpsSnapshot(): Promise<WhatsappOpsSnapshot> {
  const sessions = Array.from(getAllSessions().entries());

  const counts = sessions.reduce(
    (acc, [, session]) => {
      acc.total += 1;
      if (session.status === "connected") acc.connected += 1;
      else if (session.status === "waiting_qr") acc.waiting += 1;
      else if (session.status === "disconnected") acc.disconnected += 1;
      else acc.idle += 1;
      return acc;
    },
    { total: 0, connected: 0, waiting: 0, disconnected: 0, idle: 0 },
  );

  const recentConnectionErrors = sessions
    .map(([userId, session]) => ({
      userId,
      status: session.status,
      lastError: session.lastError,
      lastErrorAt: session.lastErrorAt ?? null,
    }))
    .filter((session) => Boolean(session.lastError))
    .sort((a, b) => {
      const aTime = a.lastErrorAt ? Date.parse(a.lastErrorAt) : 0;
      const bTime = b.lastErrorAt ? Date.parse(b.lastErrorAt) : 0;
      return bTime - aTime || a.userId.localeCompare(b.userId);
    })
    .slice(0, 10)
    .map((session) => ({
      userId: session.userId,
      status: session.status,
      lastError: session.lastError,
      lastErrorAt: session.lastErrorAt,
    }));

  return {
    generatedAt: new Date().toISOString(),
    counts,
    recentConnectionErrors,
  };
}

function getActiveWaConnections(): number {
  return Array.from(getAllSessions().values()).filter((session) => session.status === "connected").length;
}

function andSentSince(since: Date) {
  const sinceIso = since.toISOString();
  return sql`${messageLog.status} = 'sent' AND ${messageLog.createdAt} >= ${sinceIso}`;
}
