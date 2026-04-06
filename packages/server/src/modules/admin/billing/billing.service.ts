import { desc, eq } from "drizzle-orm";
import { db } from "../../../database";
import { invoice, subscription, user } from "../../../database/schema";
import { ServiceError } from "../../whatsapp/wa-socket";

export type SubscriptionRow = typeof subscription.$inferSelect;
export type InvoiceRow = typeof invoice.$inferSelect;

export type SubscriptionResponse = {
  id: string;
  userId: string;
  plan: string;
  status: string;
  startedAt: string;
  endsAt: string | null;
  trialUsed: boolean;
  updatedAt: string;
};

export type InvoiceResponse = {
  id: string;
  userId: string;
  subscriptionId: string | null;
  amount: number;
  currency: string;
  status: string;
  periodStart: string;
  periodEnd: string;
  paidAt: string | null;
};

function toIso(value: Date | string | number | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function serializeSubscription(row: SubscriptionRow): SubscriptionResponse {
  return {
    id: row.id,
    userId: row.userId,
    plan: row.plan,
    status: row.status,
    startedAt: toIso(row.startedAt) ?? new Date(row.startedAt).toISOString(),
    endsAt: toIso(row.endsAt),
    trialUsed: row.trialUsed,
    updatedAt: toIso(row.updatedAt) ?? new Date(row.updatedAt).toISOString(),
  };
}

export function serializeInvoice(row: InvoiceRow): InvoiceResponse {
  return {
    id: row.id,
    userId: row.userId,
    subscriptionId: row.subscriptionId,
    amount: row.amount,
    currency: row.currency,
    status: row.status,
    periodStart: toIso(row.periodStart) ?? new Date(row.periodStart).toISOString(),
    periodEnd: toIso(row.periodEnd) ?? new Date(row.periodEnd).toISOString(),
    paidAt: toIso(row.paidAt),
  };
}

export async function listSubscriptions(): Promise<SubscriptionResponse[]> {
  const rows = await db.select().from(subscription).orderBy(desc(subscription.updatedAt)).all();
  return rows.map(serializeSubscription);
}

export async function getSubscriptionById(id: string): Promise<SubscriptionRow> {
  const row = await db.select().from(subscription).where(eq(subscription.id, id)).get();
  if (!row) {
    throw new ServiceError("Subscription not found", 404);
  }
  return row;
}

export async function updateSubscription(id: string, updates: Partial<Pick<SubscriptionRow, "plan" | "status">>): Promise<SubscriptionResponse> {
  const existing = await getSubscriptionById(id);
  const next = {
    plan: updates.plan ?? existing.plan,
    status: updates.status ?? existing.status,
    updatedAt: new Date(),
  };

  await db.update(subscription).set(next).where(eq(subscription.id, id));
  return serializeSubscription({ ...existing, ...next });
}

export async function listInvoices(): Promise<InvoiceResponse[]> {
  const rows = await db.select().from(invoice).orderBy(desc(invoice.periodEnd)).all();
  return rows.map(serializeInvoice);
}

export async function getInvoiceById(id: string): Promise<InvoiceRow> {
  const row = await db.select().from(invoice).where(eq(invoice.id, id)).get();
  if (!row) {
    throw new ServiceError("Invoice not found", 404);
  }
  return row;
}

export async function createInvoice(input: {
  userId: string;
  subscriptionId: string | null;
  amount: number;
  currency: string;
  status: string;
  periodStart: Date;
  periodEnd: Date;
  paidAt: Date | null;
}): Promise<InvoiceResponse> {
  const userRow = await db.select({ id: user.id }).from(user).where(eq(user.id, input.userId)).get();
  if (!userRow) {
    throw new ServiceError("User not found", 404);
  }

  if (input.subscriptionId) {
    const subscriptionRow = await db
      .select({ id: subscription.id, userId: subscription.userId })
      .from(subscription)
      .where(eq(subscription.id, input.subscriptionId))
      .get();

    if (!subscriptionRow) {
      throw new ServiceError("Subscription not found", 404);
    }

    if (subscriptionRow.userId !== input.userId) {
      throw new ServiceError("Subscription does not belong to the given user", 400);
    }
  }

  const id = crypto.randomUUID();
  const nowPaidAt = input.status === "paid" && !input.paidAt ? new Date() : input.paidAt;

  await db.insert(invoice).values({
    id,
    userId: input.userId,
    subscriptionId: input.subscriptionId,
    amount: input.amount,
    currency: input.currency,
    status: input.status,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    paidAt: nowPaidAt,
  });

  return serializeInvoice({
    id,
    userId: input.userId,
    subscriptionId: input.subscriptionId,
    amount: input.amount,
    currency: input.currency,
    status: input.status,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    paidAt: nowPaidAt,
  });
}

export async function updateInvoice(id: string, updates: {
  status?: string;
  paidAt?: Date | null;
}): Promise<InvoiceResponse> {
  const existing = await getInvoiceById(id);
  const nextStatus = updates.status ?? existing.status;
  const nextPaidAt = updates.paidAt !== undefined
    ? updates.paidAt
    : nextStatus === "paid" && !existing.paidAt
      ? new Date()
      : existing.paidAt;

  await db.update(invoice).set({
    status: nextStatus,
    paidAt: nextPaidAt,
  }).where(eq(invoice.id, id));

  return serializeInvoice({
    ...existing,
    status: nextStatus,
    paidAt: nextPaidAt,
  });
}
