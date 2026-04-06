import type { Context } from "hono";
import { auth } from "../../../core/auth";
import { handle } from "../../../core/handle";
import { ServiceError } from "../../whatsapp/wa-socket";
import { getAdminRequestContext, writeAdminAuditLog } from "../audit-log.service";
import * as billingService from "./billing.service";

type ParsedDateInput = string | number | null | undefined;

async function getSessionRole(c: Context): Promise<"user" | "admin" | null> {
  try {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    return (session?.user?.role as "user" | "admin" | undefined) ?? null;
  } catch {
    return null;
  }
}

async function readJsonBody(c: Context): Promise<Record<string, unknown>> {
  try {
    const body = await c.req.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new ServiceError("Invalid request body", 400);
    }
    return body as Record<string, unknown>;
  } catch (error) {
    if (error instanceof ServiceError) {
      throw error;
    }
    throw new ServiceError("Invalid request body", 400);
  }
}

function parseNonEmptyString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new ServiceError(`${fieldName} must be a non-empty string`, 400);
  }
  return value.trim();
}

function parseNumber(value: unknown, fieldName: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ServiceError(`${fieldName} must be a number`, 400);
  }
  return value;
}

function parseDate(value: ParsedDateInput, fieldName: string): Date | null {
  if (value === null || value === undefined) {
    return null;
  }

  const date = typeof value === "string" || typeof value === "number" ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) {
    throw new ServiceError(`${fieldName} must be a valid date`, 400);
  }
  return date;
}

export async function listSubscriptions(c: Context) {
  return handle(c, async () => {
    const subscriptions = await billingService.listSubscriptions();
    return { subscriptions };
  });
}

export async function patchSubscription(c: Context) {
  return handle(c, async () => {
    const id = c.req.param("id");
    if (!id) {
      throw new ServiceError("Missing id parameter", 400);
    }

    const body = await readJsonBody(c);
    const hasPlan = Object.prototype.hasOwnProperty.call(body, "plan");
    const hasStatus = Object.prototype.hasOwnProperty.call(body, "status");

    if (!hasPlan && !hasStatus) {
      throw new ServiceError("At least one of plan or status is required", 400);
    }

    const role = await getSessionRole(c);

    const updates: { plan?: string; status?: string } = {};
    if (hasPlan) {
      if (role !== "admin") {
        throw new ServiceError("Only admins can change subscription plans", 403);
      }
      updates.plan = parseNonEmptyString(body.plan, "plan");
    }
    if (hasStatus) {
      updates.status = parseNonEmptyString(body.status, "status");
    }

    const subscription = await billingService.updateSubscription(id, updates);
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (session?.user?.id) {
      const requestContext = getAdminRequestContext(c);
      await writeAdminAuditLog({
        actorUserId: session.user.id,
        action: "UPDATE_SUBSCRIPTION",
        targetType: "subscription",
        targetId: id,
        metadata: { updates },
        ...requestContext,
      }).catch(() => undefined);
    }
    return { subscription };
  });
}

export async function listInvoices(c: Context) {
  return handle(c, async () => {
    const invoices = await billingService.listInvoices();
    return { invoices };
  });
}

export async function postInvoice(c: Context) {
  return handle(c, async () => {
    const body = await readJsonBody(c);

    const userId = parseNonEmptyString(body.userId, "userId");
    const amount = parseNumber(body.amount, "amount");
    const currency = parseNonEmptyString(body.currency, "currency");
    const status = parseNonEmptyString(body.status, "status");
    const periodStart = parseDate(body.periodStart as ParsedDateInput, "periodStart");
    const periodEnd = parseDate(body.periodEnd as ParsedDateInput, "periodEnd");

    if (!periodStart || !periodEnd) {
      throw new ServiceError("periodStart and periodEnd are required", 400);
    }

    if (amount < 0) {
      throw new ServiceError("amount must be greater than or equal to 0", 400);
    }

    const subscriptionId = body.subscriptionId === undefined || body.subscriptionId === null
      ? null
      : parseNonEmptyString(body.subscriptionId, "subscriptionId");

    const paidAt = body.paidAt === undefined ? null : parseDate(body.paidAt as ParsedDateInput, "paidAt");

    const invoice = await billingService.createInvoice({
      userId,
      subscriptionId,
      amount,
      currency,
      status,
      periodStart,
      periodEnd,
      paidAt,
    });
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (session?.user?.id) {
      const requestContext = getAdminRequestContext(c);
      await writeAdminAuditLog({
        actorUserId: session.user.id,
        action: "CREATE_INVOICE",
        targetType: "invoice",
        targetId: invoice.id,
        metadata: {
          userId,
          subscriptionId,
          amount,
          currency,
          status,
          periodStart: periodStart.toISOString(),
          periodEnd: periodEnd.toISOString(),
          paidAt: paidAt?.toISOString() ?? null,
        },
        ...requestContext,
      }).catch(() => undefined);
    }

    return { invoice };
  }, 201);
}

export async function patchInvoice(c: Context) {
  return handle(c, async () => {
    const id = c.req.param("id");
    if (!id) {
      throw new ServiceError("Missing id parameter", 400);
    }

    const body = await readJsonBody(c);
    const hasStatus = Object.prototype.hasOwnProperty.call(body, "status");
    const hasPaidAt = Object.prototype.hasOwnProperty.call(body, "paidAt");

    if (!hasStatus && !hasPaidAt) {
      throw new ServiceError("At least one of status or paidAt is required", 400);
    }

    const updates: { status?: string; paidAt?: Date | null } = {};

    if (hasStatus) {
      updates.status = parseNonEmptyString(body.status, "status");
    }

    if (hasPaidAt) {
      updates.paidAt = parseDate(body.paidAt as ParsedDateInput, "paidAt");
    }

    const invoice = await billingService.updateInvoice(id, updates);
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (session?.user?.id) {
      const requestContext = getAdminRequestContext(c);
      await writeAdminAuditLog({
        actorUserId: session.user.id,
        action: "UPDATE_INVOICE",
        targetType: "invoice",
        targetId: id,
        metadata: updates,
        ...requestContext,
      }).catch(() => undefined);
    }
    return { invoice };
  });
}
