import type { Context } from "hono";
import { handle } from "../../core/handle";
import * as connectionService from "./wa-connection.service";
import { logger } from "../../core/logger";

export async function initConnection(c: Context) {
  return handle(c, async () => {
    const userId = c.get("userId") as string;
    await connectionService.init(userId);
    return { message: "WhatsApp initializing" };
  });
}

export async function getStatus(c: Context) {
  const userId = c.get("userId") as string;
  return c.json(connectionService.getStatus(userId));
}

export async function disconnect(c: Context) {
  return handle(c, async () => {
    const userId = c.get("userId") as string;
    logger.info("User disconnected WhatsApp", { userId });
    await connectionService.disconnect(userId);
    return { message: "Disconnected" };
  });
}
