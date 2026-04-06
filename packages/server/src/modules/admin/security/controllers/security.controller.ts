import type { Context } from "hono";
import { auth } from "../../../../core/auth";
import { getAdminRequestContext, writeAdminAuditLog } from "../services";
import * as securityService from "../services";

export async function getSessions(c: Context) {
  const sessions = await securityService.listSessions();
  return c.json({ sessions });
}

export async function revokeSession(c: Context) {
  const body = await c.req.json().catch(() => null);
  const sessionId =
    typeof body?.sessionId === "string"
      ? body.sessionId.trim()
      : typeof body?.id === "string"
        ? body.id.trim()
        : "";

  if (!sessionId) {
    return c.json({ error: "Bad Request", message: "sessionId is required" }, 400);
  }

  const revoked = await securityService.revokeSessionById(sessionId);
  if (!revoked) {
    return c.json({ error: "Not Found", message: "Session not found" }, 404);
  }

  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (session?.user?.id) {
    const requestContext = getAdminRequestContext(c);
    await writeAdminAuditLog({
      actorUserId: session.user.id,
      action: "REVOKE_SESSION",
      targetType: "session",
      targetId: sessionId,
      metadata: {
        revokedUserId: revoked.userId,
      },
      ...requestContext,
    }).catch(() => undefined);
  }

  return c.json({
    message: "Session revoked",
    sessionId,
  });
}

export async function getSecurityEvents(c: Context) {
  const events = await securityService.listSecurityEvents();
  return c.json({ events });
}
