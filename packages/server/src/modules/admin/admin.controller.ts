import type { Context } from "hono";
import { handle } from "../../core/handle";
import { ServiceError } from "../whatsapp/wa-socket";
import * as adminService from "./admin.service";

export async function getOverview(c: Context) {
  const overview = await adminService.getAdminOverview();
  return c.json(overview);
}

export async function getSystemHealth(c: Context) {
  const health = await adminService.getSystemHealth();
  return c.json(health, health.status === "ok" ? 200 : 503);
}

function parsePositiveInt(value: string | undefined, fallback: number, fieldName: string): number {
  if (value === undefined || value.trim() === "") {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new ServiceError(`${fieldName} must be a positive integer`, 400);
  }

  return parsed;
}

function parseOptionalText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export async function listTrials(c: Context) {
  return handle(c, async () => {
    const page = parsePositiveInt(c.req.query("page") ?? undefined, 1, "page");
    const limit = parsePositiveInt(c.req.query("limit") ?? undefined, 25, "limit");
    const phone = parseOptionalText(c.req.query("phone") ?? c.req.query("phoneNumber") ?? undefined);
    const user = parseOptionalText(c.req.query("user") ?? c.req.query("userId") ?? undefined);

    return adminService.listTrialUsage({
      page,
      limit: Math.min(limit, 100),
      phone,
      user,
    });
  });
}

export async function getWhatsappOps(c: Context) {
  return handle(c, async () => {
    return adminService.getWhatsappOpsSnapshot();
  });
}
