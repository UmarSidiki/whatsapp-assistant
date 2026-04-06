import { desc, eq } from "drizzle-orm";
import { db } from "../../../database";
import { session, securityEvent, user as userTable } from "../../../database/schema";

export async function listSessions() {
  const rows = await db
    .select({
      id: session.id,
      expiresAt: session.expiresAt,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      ipAddress: session.ipAddress,
      userAgent: session.userAgent,
      userId: session.userId,
      user: {
        id: userTable.id,
        name: userTable.name,
        email: userTable.email,
        role: userTable.role,
        image: userTable.image,
        createdAt: userTable.createdAt,
        updatedAt: userTable.updatedAt,
      },
    })
    .from(session)
    .leftJoin(userTable, eq(session.userId, userTable.id))
    .orderBy(desc(session.createdAt));

  return rows.map((row) => ({
    ...row,
    user: row.user?.id
      ? row.user
      : null,
  }));
}

export async function revokeSessionById(sessionId: string) {
  const [existing] = await db
    .select({ id: session.id, userId: session.userId })
    .from(session)
    .where(eq(session.id, sessionId))
    .limit(1);

  if (!existing) {
    return null;
  }

  await db.delete(session).where(eq(session.id, sessionId));
  return existing;
}

export async function listSecurityEvents() {
  const rows = await db
    .select({
      id: securityEvent.id,
      type: securityEvent.type,
      severity: securityEvent.severity,
      userId: securityEvent.userId,
      ipAddress: securityEvent.ipAddress,
      detail: securityEvent.detail,
      createdAt: securityEvent.createdAt,
      user: {
        id: userTable.id,
        name: userTable.name,
        email: userTable.email,
        role: userTable.role,
        image: userTable.image,
      },
    })
    .from(securityEvent)
    .leftJoin(userTable, eq(securityEvent.userId, userTable.id))
    .orderBy(desc(securityEvent.createdAt));

  return rows.map((row) => ({
    ...row,
    user: row.user?.id ? row.user : null,
  }));
}
