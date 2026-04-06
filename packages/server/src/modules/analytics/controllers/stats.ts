import type { Context } from "hono";
import * as statsService from "../services";
import { getSessionIfExists } from "../../whatsapp/services";
import { logger } from "../../../core/logger";

export async function getStats(c: Context) {
  const userId = c.get("userId") as string;
  const session = getSessionIfExists(userId);

  try {
    const stats = await statsService.getStats(userId);
    return c.json({ ...stats, connectionStatus: session?.status ?? "disconnected" });
  } catch (error) {
    logger.error("Failed to load dashboard stats", { userId, error: String(error) });

    return c.json({
      totalSent: 0,
      totalFailed: 0,
      sentToday: 0,
      failedToday: 0,
      dailyActivity: [],
      scheduledPending: 0,
      autoReplyRules: 0,
      templates: 0,
      connectionStatus: session?.status ?? "disconnected",
    });
  }
}
