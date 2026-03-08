import type { Context } from "hono";
import * as statsService from "./stats.service";
import { getSessionIfExists } from "../whatsapp/wa-socket";

export async function getStats(c: Context) {
  const userId = c.get("userId") as string;
  const stats = await statsService.getStats(userId);
  const session = getSessionIfExists(userId);
  return c.json({ ...stats, connectionStatus: session?.status ?? "disconnected" });
}
