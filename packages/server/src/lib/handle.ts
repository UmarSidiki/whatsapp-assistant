import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { ServiceError } from "../services/wa-socket";

/**
 * Wraps a service call in try/catch.
 * - On success: returns the result with the given status code (default 200).
 * - On ServiceError: returns a JSON error with the error's HTTP status code.
 * - On any other error: rethrows (becomes a 500).
 */
export async function handle<T>(
  c: Context,
  fn: () => T | Promise<T>,
  successStatus: ContentfulStatusCode = 200
) {
  try {
    const result = await fn();
    return c.json(result, successStatus);
  } catch (e) {
    if (e instanceof ServiceError) {
      return c.json({ error: e.message }, e.statusCode as ContentfulStatusCode);
    }
    throw e;
  }
}
