import type { Context } from "hono";
import { ServiceError } from "../../whatsapp/services";
import { listAdminAuditLogs } from "../services";

function parseDateParam(value: string | undefined, fieldName: string): Date | undefined {
  if (!value) {
    return undefined;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new ServiceError(`${fieldName} must be a valid date`, 400);
  }

  return date;
}

function parseIntParam(value: string | undefined, fieldName: string, fallback: number): number {
  if (value === undefined || value === "") {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new ServiceError(`${fieldName} must be a positive integer`, 400);
  }

  return parsed;
}

export async function getAuditLogs(c: Context) {
  const actorUserId = c.req.query("actor")?.trim() || undefined;
  const action = c.req.query("action")?.trim() || undefined;
  const startDate = parseDateParam(c.req.query("startDate") || undefined, "startDate");
  const endDate = parseDateParam(c.req.query("endDate") || undefined, "endDate");
  const page = parseIntParam(c.req.query("page") || undefined, "page", 1);
  const limit = Math.min(200, parseIntParam(c.req.query("limit") || undefined, "limit", 50));

  const result = await listAdminAuditLogs({
    actorUserId,
    action,
    startDate,
    endDate,
    page,
    limit,
  });

  return c.json({
    ...result,
    page,
    limit,
  });
}
