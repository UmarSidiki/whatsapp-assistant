import type { Context, Next } from "hono";
import { auth } from "./auth";

export type UserRole = "user" | "admin";

type AuthUser = {
  id: string;
  role?: UserRole | null;
};

async function getSessionUser(c: Context): Promise<AuthUser | null> {
  try {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    const user = session?.user;

    if (!user?.id) {
      return null;
    }

    return {
      id: user.id,
      role: user.role as UserRole | null | undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Extract userId from the better-auth session cookie.
 * Sets c.set("userId", ...) for downstream handlers.
 * Returns 401 if no valid session.
 */
export async function requireAuth(c: Context, next: Next) {
  const user = await getSessionUser(c);
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  c.set("userId", user.id);
  await next();
}

async function requireRole(c: Context, next: Next, allowedRoles: UserRole[]) {
  const user = await getSessionUser(c);
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  if (!user.role || !allowedRoles.includes(user.role)) {
    return c.json(
      { error: "Forbidden", message: "Insufficient admin privileges" },
      403,
    );
  }

  c.set("userId", user.id);
  await next();
}

export async function requireAdmin(c: Context, next: Next) {
  return requireRole(c, next, ["admin"]);
}
