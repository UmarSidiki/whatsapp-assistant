import type { Context } from "hono";
import { handle } from "../../../core/utils";
import * as chatsService from "../services/chats";
import { ServiceError } from "../types";

export async function getSettings(c: Context) {
  return handle(c, async () => {
    const userId = c.get("userId") as string;
    return chatsService.getChatSettings(userId);
  });
}

export async function updateSettings(c: Context) {
  return handle(c, async () => {
    const userId = c.get("userId") as string;
    const body = await c.req.json<{ historyLimit?: unknown }>();

    if (typeof body.historyLimit !== "number") {
      throw new ServiceError("historyLimit must be provided as a number", 400);
    }

    return chatsService.updateChatSettings(userId, body.historyLimit);
  });
}
