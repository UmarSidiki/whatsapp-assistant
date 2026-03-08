import type { Context, Next } from "hono";
import { auth } from "./auth";

/**
 * Extract userId from the better-auth session cookie.
 * Sets c.set("userId", ...) for downstream handlers.
 * Returns 401 if no valid session.
 */
export async function requireAuth(c: Context, next: Next) {
  try {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session?.user?.id) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    c.set("userId", session.user.id);
    await next();
  } catch {
    return c.json({ error: "Unauthorized" }, 401);
  }
}
