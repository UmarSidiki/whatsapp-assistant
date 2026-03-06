import type { Context } from "hono";
import * as statsService from "../services/stats.service";
import { wa } from "../services/wa-socket";

export async function getStats(c: Context) {
  const stats = await statsService.getStats();
  return c.json({ ...stats, connectionStatus: wa.status });
}
