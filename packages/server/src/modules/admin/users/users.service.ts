import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../../../database";
import { subscription, trialUsage, user } from "../../../database/schema";
import { ServiceError } from "../../whatsapp/wa-socket";
import type { UserRole } from "../../../core/auth-middleware";

export type UserRow = typeof user.$inferSelect;

export type UserListItem = {
  id: string;
  name: string | null;
  email: string | null;
  role: UserRole;
  tier: string | null;
  suspendedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type TrialSummary = {
  id: string;
  phoneNumber: string;
  userId: string | null;
  trialStartedAt: string;
  trialEndsAt: string;
  createdAt: string;
  isActive: boolean;
};

export type SubscriptionSummary = {
  id: string;
  plan: string;
  status: string;
  startedAt: string;
  endsAt: string | null;
  trialUsed: boolean;
  updatedAt: string;
};

export type UserDetails = UserListItem & {
  trial: TrialSummary | null;
  subscription: SubscriptionSummary | null;
};

function toIso(value: Date | string | number | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function serializeUser(row: UserRow): UserListItem {
  return {
    id: row.id,
    name: row.name ?? null,
    email: row.email ?? null,
    role: (row.role ?? "user") as UserRole,
    tier: row.tier ?? null,
    suspendedAt: toIso(row.suspendedAt),
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

function serializeTrialSummary(row: {
  id: string;
  phoneNumber: string;
  userId: string | null;
  trialStartedAt: Date | string | number;
  trialEndsAt: Date | string | number;
  createdAt: Date | string | number;
}): TrialSummary {
  const trialEndsAt = toIso(row.trialEndsAt) ?? new Date(row.trialEndsAt).toISOString();

  return {
    id: row.id,
    phoneNumber: row.phoneNumber,
    userId: row.userId,
    trialStartedAt: toIso(row.trialStartedAt) ?? new Date(row.trialStartedAt).toISOString(),
    trialEndsAt,
    createdAt: toIso(row.createdAt) ?? new Date(row.createdAt).toISOString(),
    isActive: new Date(trialEndsAt).getTime() > Date.now(),
  };
}

function serializeSubscriptionSummary(row: typeof subscription.$inferSelect): SubscriptionSummary {
  return {
    id: row.id,
    plan: row.plan,
    status: row.status,
    startedAt: toIso(row.startedAt) ?? new Date(row.startedAt).toISOString(),
    endsAt: toIso(row.endsAt),
    trialUsed: row.trialUsed,
    updatedAt: toIso(row.updatedAt) ?? new Date(row.updatedAt).toISOString(),
  };
}

function normalizeSearchTerm(value: string): string {
  return `%${value.trim().toLowerCase()}%`;
}

function buildLikeFilter(column: typeof user.email | typeof user.name, value: string) {
  return sql<boolean>`lower(${column}) like ${normalizeSearchTerm(value)}`;
}

async function getUserRowOrThrow(id: string): Promise<UserRow> {
  const row = await db.select().from(user).where(eq(user.id, id)).get();
  if (!row) {
    throw new ServiceError("User not found", 404);
  }
  return row;
}

export async function listUsers(filters: {
  email?: string;
  name?: string;
  q?: string;
  limit: number;
  offset: number;
}): Promise<{ users: UserListItem[]; total: number }> {
  const conditions = [];

  if (filters.email) {
    conditions.push(buildLikeFilter(user.email, filters.email));
  }

  if (filters.name) {
    conditions.push(buildLikeFilter(user.name, filters.name));
  }

  if (filters.q) {
    const q = normalizeSearchTerm(filters.q);
    conditions.push(sql<boolean>`(
      lower(${user.email}) like ${q}
      or lower(${user.name}) like ${q}
    )`);
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [rows, countResult] = await Promise.all([
    db
      .select()
      .from(user)
      .where(whereClause)
      .orderBy(desc(user.createdAt), desc(user.id))
      .limit(filters.limit)
      .offset(filters.offset)
      .all(),
    db
      .select({ count: sql<number>`count(*)` })
      .from(user)
      .where(whereClause)
      .get(),
  ]);

  return {
    users: rows.map(serializeUser),
    total: countResult?.count ?? 0,
  };
}

export async function getUserDetails(id: string): Promise<UserDetails> {
  const userRow = await getUserRowOrThrow(id);

  const [trialRow] = await db
    .select()
    .from(trialUsage)
    .where(eq(trialUsage.userId, id))
    .orderBy(desc(trialUsage.trialStartedAt), desc(trialUsage.createdAt))
    .limit(1)
    .all();

  const [subscriptionRow] = await db
    .select()
    .from(subscription)
    .where(eq(subscription.userId, id))
    .orderBy(desc(subscription.updatedAt), desc(subscription.startedAt))
    .limit(1)
    .all();

  return {
    ...serializeUser(userRow),
    trial: trialRow ? serializeTrialSummary(trialRow) : null,
    subscription: subscriptionRow ? serializeSubscriptionSummary(subscriptionRow) : null,
  };
}

export async function updateUserRole(id: string, role: UserRole): Promise<UserListItem> {
  const userRow = await getUserRowOrThrow(id);

  await db
    .update(user)
    .set({ role, updatedAt: new Date() })
    .where(eq(user.id, id))
    .run();

  return {
    ...serializeUser({ ...userRow, role }),
    updatedAt: new Date().toISOString(),
  };
}

export async function setUserSuspension(id: string, suspended: boolean): Promise<UserListItem> {
  const userRow = await getUserRowOrThrow(id);
  const suspendedAt = suspended ? new Date() : null;

  await db
    .update(user)
    .set({ suspendedAt, updatedAt: new Date() })
    .where(eq(user.id, id))
    .run();

  return {
    ...serializeUser({ ...userRow, suspendedAt }),
    suspendedAt: suspendedAt ? suspendedAt.toISOString() : null,
    updatedAt: new Date().toISOString(),
  };
}

export async function updateUsersRole(userIds: string[], role: UserRole): Promise<number> {
  if (userIds.length === 0) {
    return 0;
  }

  const result = await db
    .update(user)
    .set({ role, updatedAt: new Date() })
    .where(inArray(user.id, userIds))
    .run();

  return result.changes ?? 0;
}

export async function setUsersSuspension(userIds: string[], suspended: boolean): Promise<number> {
  if (userIds.length === 0) {
    return 0;
  }

  const suspendedAt = suspended ? new Date() : null;
  const result = await db
    .update(user)
    .set({ suspendedAt, updatedAt: new Date() })
    .where(inArray(user.id, userIds))
    .run();

  return result.changes ?? 0;
}
