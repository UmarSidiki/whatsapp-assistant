import { Context, Next } from 'hono'

/**
 * Middleware to prevent API routes from falling through to the SPA fallback.
 * Returns 404 JSON for any unmatched /api/* routes.
 */
export async function apiGuard(c: Context, next: Next) {
  const path = c.req.path
  
  // If this is an API route, don't serve static files
  if (path.startsWith('/api/')) {
    return c.json({ error: 'Not Found', path }, 404)
  }
  
  await next()
}
