import type { Context } from "hono";
import { auth } from "../../../core/auth";
import { handle } from "../../../core/handle";
import { ServiceError } from "../../whatsapp/wa-socket";
import { getAdminRequestContext, writeAdminAuditLog } from "../audit-log.service";
import type { UserRole } from "../../../core/auth-middleware";
import * as usersService from "./users.service";

function parseNonEmptyString(value: string | null, fieldName: string): string {
  if (typeof value !== "string") {
    throw new ServiceError(`${fieldName} is required`, 400);
  }

  const trimmed = value.trim();
  if (!trimmed) {
    throw new ServiceError(`${fieldName} cannot be empty`, 400);
  }

  return trimmed;
}

function parseOptionalSearch(
  value: string | null | undefined,
  fieldName: string,
): string | undefined {
  if (value == null) {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    throw new ServiceError(`${fieldName} cannot be empty`, 400);
  }

  return trimmed;
}

function parseLimit(value: string | null | undefined): number {
  if (value == null) {
    return 25;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
    throw new ServiceError("limit must be an integer between 1 and 100", 400);
  }

  return parsed;
}

function parseOffset(value: string | null | undefined): number {
  if (value == null) {
    return 0;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new ServiceError("offset must be a non-negative integer", 400);
  }

  return parsed;
}

function parseRole(value: unknown): UserRole {
  if (typeof value !== "string") {
    throw new ServiceError("role is required", 400);
  }

  const role = value.trim();
  if (role !== "user" && role !== "admin") {
    throw new ServiceError("role must be one of: user, admin", 400);
  }

  return role;
}

function parseUserIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ServiceError("userIds must be a non-empty array", 400);
  }

  const ids = value.map((item) => {
    if (typeof item !== "string") {
      throw new ServiceError("Each userId must be a string", 400);
    }
    const trimmed = item.trim();
    if (!trimmed) {
      throw new ServiceError("userIds cannot contain empty values", 400);
    }
    return trimmed;
  });

  return [...new Set(ids)];
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

export async function listUsers(c: Context) {
  return handle(c, async () => {
    const email = parseOptionalSearch(c.req.query("email"), "email");
    const name = parseOptionalSearch(c.req.query("name"), "name");
    const q = parseOptionalSearch(c.req.query("q"), "q");
    const limit = parseLimit(c.req.query("limit"));
    const offset = parseOffset(c.req.query("offset"));

    const { users, total } = await usersService.listUsers({ email, name, q, limit, offset });
    return { users, total, limit, offset };
  });
}

export async function getUser(c: Context) {
  return handle(c, async () => {
    const id = parseNonEmptyString(c.req.param("id"), "id");
    const user = await usersService.getUserDetails(id);
    return { user };
  });
}

export async function patchUserRole(c: Context) {
  return handle(c, async () => {
    const id = parseNonEmptyString(c.req.param("id"), "id");
    const body = await readJsonBody(c);

    if (Object.keys(body).some((key) => key !== "role")) {
      throw new ServiceError("Only role can be updated", 400);
    }

    const role = parseRole(body.role);
    const user = await usersService.updateUserRole(id, role);
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (session?.user?.id) {
      const requestContext = getAdminRequestContext(c);
      await writeAdminAuditLog({
        actorUserId: session.user.id,
        action: "UPDATE_USER_ROLE",
        targetType: "user",
        targetId: id,
        metadata: {
          role,
        },
        ...requestContext,
      }).catch(() => undefined);
    }
    return { user };
  });
}

export async function patchBulkUserRole(c: Context) {
  return handle(c, async () => {
    const body = await readJsonBody(c);
    if (Object.keys(body).some((key) => key !== "userIds" && key !== "role")) {
      throw new ServiceError("Only userIds and role can be updated", 400);
    }

    const userIds = parseUserIds(body.userIds);
    const role = parseRole(body.role);
    const updatedCount = await usersService.updateUsersRole(userIds, role);

    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (session?.user?.id) {
      const requestContext = getAdminRequestContext(c);
      await writeAdminAuditLog({
        actorUserId: session.user.id,
        action: "BULK_UPDATE_USER_ROLE",
        targetType: "user",
        targetId: "multiple",
        metadata: {
          userIds,
          role,
          updatedCount,
        },
        ...requestContext,
      }).catch(() => undefined);
    }

    return { updatedCount };
  });
}

export async function suspendUser(c: Context) {
  return handle(c, async () => {
    const id = parseNonEmptyString(c.req.param("id"), "id");
    const user = await usersService.setUserSuspension(id, true);
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (session?.user?.id) {
      const requestContext = getAdminRequestContext(c);
      await writeAdminAuditLog({
        actorUserId: session.user.id,
        action: "SUSPEND_USER",
        targetType: "user",
        targetId: id,
        metadata: {
          suspended: true,
        },
        ...requestContext,
      }).catch(() => undefined);
    }
    return { user };
  });
}

export async function unsuspendUser(c: Context) {
  return handle(c, async () => {
    const id = parseNonEmptyString(c.req.param("id"), "id");
    const user = await usersService.setUserSuspension(id, false);
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (session?.user?.id) {
      const requestContext = getAdminRequestContext(c);
      await writeAdminAuditLog({
        actorUserId: session.user.id,
        action: "UNSUSPEND_USER",
        targetType: "user",
        targetId: id,
        metadata: {
          suspended: false,
        },
        ...requestContext,
      }).catch(() => undefined);
    }
    return { user };
  });
}

export async function patchBulkUserSuspension(c: Context) {
  return handle(c, async () => {
    const body = await readJsonBody(c);
    if (Object.keys(body).some((key) => key !== "userIds" && key !== "suspended")) {
      throw new ServiceError("Only userIds and suspended can be updated", 400);
    }

    if (typeof body.suspended !== "boolean") {
      throw new ServiceError("suspended must be a boolean", 400);
    }

    const userIds = parseUserIds(body.userIds);
    const suspended = body.suspended;
    const updatedCount = await usersService.setUsersSuspension(userIds, suspended);

    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (session?.user?.id) {
      const requestContext = getAdminRequestContext(c);
      await writeAdminAuditLog({
        actorUserId: session.user.id,
        action: suspended ? "BULK_SUSPEND_USER" : "BULK_UNSUSPEND_USER",
        targetType: "user",
        targetId: "multiple",
        metadata: {
          userIds,
          suspended,
          updatedCount,
        },
        ...requestContext,
      }).catch(() => undefined);
    }

    return { updatedCount };
  });
}
