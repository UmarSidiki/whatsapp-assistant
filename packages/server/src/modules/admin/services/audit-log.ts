import type { Context } from "hono";
import { and, count, desc, eq, gte, lte, type SQL } from "drizzle-orm";
import { db } from "../../../database";
import { adminAuditLog, user } from "../../../database";

export const ADMIN_AUDIT_ACTIONS = {
  UPDATE_SUBSCRIPTION: "UPDATE_SUBSCRIPTION",
  CREATE_INVOICE: "CREATE_INVOICE",
  UPDATE_INVOICE: "UPDATE_INVOICE",
  REVOKE_SESSION: "REVOKE_SESSION",
} as const;

export type AdminAuditAction = (typeof ADMIN_AUDIT_ACTIONS)[keyof typeof ADMIN_AUDIT_ACTIONS];

export type AdminAuditTargetType =
  | "user"
  | "session"
  | "subscription"
  | "invoice"
  | "feature_flag";

export interface AdminAuditRequestContext {
  ipAddress: string | null;
  userAgent: string | null;
}

export interface CreateAdminAuditLogInput {
  actorUserId: string;
  action: AdminAuditAction | string;
  targetType: AdminAuditTargetType | string;
  targetId: string;
  metadata?: Record<string, unknown> | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  createdAt?: Date;
}

export interface AdminAuditLogRecord {
  id: string;
  actorUserId: string;
  action: string;
  targetType: string;
  targetId: string;
  metadata: Record<string, unknown> | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  actor: {
    id: string;
    name: string | null;
    email: string | null;
    role: string;
  } | null;
}

export interface AdminAuditLogFilters {
  actorUserId?: string;
  action?: string;
  startDate?: Date;
  endDate?: Date;
  page?: number;
  limit?: number;
}

function parseMetadata(metadata: string | null): Record<string, unknown> | null {
  if (!metadata) {
    return null;
  }

  try {
    const parsed = JSON.parse(metadata);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function toIso(value: Date | string | number): string {
  const date = value instanceof Date ? value : new Date(value);
  return date.toISOString();
}

export function getAdminRequestContext(c: Context): AdminAuditRequestContext {
  const forwardedFor = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const realIp = c.req.header("x-real-ip")?.trim() ?? null;
  const connectingIp = c.req.header("cf-connecting-ip")?.trim() ?? null;
  const userAgent = c.req.header("user-agent")?.trim() ?? null;

  return {
    ipAddress: forwardedFor || realIp || connectingIp,
    userAgent,
  };
}

export async function writeAdminAuditLog(input: CreateAdminAuditLogInput): Promise<void> {
  if (!input.actorUserId.trim()) {
    throw new Error("actorUserId is required");
  }
  if (!input.action.trim()) {
    throw new Error("action is required");
  }
  if (!input.targetType.trim()) {
    throw new Error("targetType is required");
  }
  if (!input.targetId.trim()) {
    throw new Error("targetId is required");
  }

  await db.insert(adminAuditLog).values({
    id: crypto.randomUUID(),
    actorUserId: input.actorUserId,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    metadata: input.metadata ? JSON.stringify(input.metadata) : null,
    ipAddress: input.ipAddress ?? null,
    userAgent: input.userAgent ?? null,
    createdAt: input.createdAt ?? new Date(),
  });
}

function buildWhere(filters: AdminAuditLogFilters): SQL | undefined {
  const conditions: SQL[] = [];

  if (filters.actorUserId) {
    conditions.push(eq(adminAuditLog.actorUserId, filters.actorUserId));
  }
  if (filters.action) {
    conditions.push(eq(adminAuditLog.action, filters.action));
  }
  if (filters.startDate) {
    conditions.push(gte(adminAuditLog.createdAt, filters.startDate));
  }
  if (filters.endDate) {
    conditions.push(lte(adminAuditLog.createdAt, filters.endDate));
  }

  return conditions.length > 0 ? and(...conditions) : undefined;
}

export async function listAdminAuditLogs(filters: AdminAuditLogFilters): Promise<{
  logs: AdminAuditLogRecord[];
  total: number;
}> {
  const page = Math.max(1, Math.floor(filters.page ?? 1));
  const limit = Math.min(200, Math.max(1, Math.floor(filters.limit ?? 50)));
  const offset = (page - 1) * limit;
  const whereClause = buildWhere(filters);

  const totalRows = whereClause
    ? await db.select({ total: count() }).from(adminAuditLog).where(whereClause)
    : await db.select({ total: count() }).from(adminAuditLog);
  const total = Number(totalRows[0]?.total ?? 0);

  const rows = whereClause
    ? await db
        .select({
          id: adminAuditLog.id,
          actorUserId: adminAuditLog.actorUserId,
          action: adminAuditLog.action,
          targetType: adminAuditLog.targetType,
          targetId: adminAuditLog.targetId,
          metadata: adminAuditLog.metadata,
          ipAddress: adminAuditLog.ipAddress,
          userAgent: adminAuditLog.userAgent,
          createdAt: adminAuditLog.createdAt,
          actor: {
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
          },
        })
        .from(adminAuditLog)
        .leftJoin(user, eq(adminAuditLog.actorUserId, user.id))
        .where(whereClause)
        .orderBy(desc(adminAuditLog.createdAt))
        .limit(limit)
        .offset(offset)
    : await db
        .select({
          id: adminAuditLog.id,
          actorUserId: adminAuditLog.actorUserId,
          action: adminAuditLog.action,
          targetType: adminAuditLog.targetType,
          targetId: adminAuditLog.targetId,
          metadata: adminAuditLog.metadata,
          ipAddress: adminAuditLog.ipAddress,
          userAgent: adminAuditLog.userAgent,
          createdAt: adminAuditLog.createdAt,
          actor: {
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
          },
        })
        .from(adminAuditLog)
        .leftJoin(user, eq(adminAuditLog.actorUserId, user.id))
        .orderBy(desc(adminAuditLog.createdAt))
        .limit(limit)
        .offset(offset);

  return {
    logs: rows.map((row) => ({
      id: row.id,
      actorUserId: row.actorUserId,
      action: row.action,
      targetType: row.targetType,
      targetId: row.targetId,
      metadata: parseMetadata(row.metadata),
      ipAddress: row.ipAddress,
      userAgent: row.userAgent,
      createdAt: toIso(row.createdAt),
      actor: row.actor?.id
        ? {
            id: row.actor.id,
            name: row.actor.name,
            email: row.actor.email,
            role: row.actor.role,
          }
        : null,
    })),
    total,
  };
}
