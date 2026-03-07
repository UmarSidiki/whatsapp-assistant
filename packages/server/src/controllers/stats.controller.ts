import type { Context } from "hono";
import * as statsService from "../services/stats.service";
import { getSessionIfExists } from "../services/wa-socket";

export async function getStats(c: Context) {
  const userId = c.get("userId") as string;
  const stats = await statsService.getStats(userId);
  const session = getSessionIfExists(userId);
  return c.json({ ...stats, connectionStatus: session?.status ?? "disconnected" });
}
