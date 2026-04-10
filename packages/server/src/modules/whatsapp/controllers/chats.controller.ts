import type { Context } from "hono";
import { handle } from "../../../core/utils";
import { ServiceError } from "../types";
import * as chatsService from "../services/chats";

export async function getChats(c: Context) {
  return handle(c, async () => {
    const userId = c.get("userId") as string;
    const scope = chatsService.parseChatsScope(c.req.query("type"));
    return { chats: await chatsService.getChats(userId, scope) };
  });
}

export async function getChatMessages(c: Context) {
  return handle(c, async () => {
    const userId = c.get("userId") as string;
    const chatId = decodeURIComponent(c.req.param("chatId"));
    const limitRaw = c.req.query("limit");
    const limit = limitRaw ? Math.min(300, Math.max(1, Number(limitRaw))) : 150;
    const messages = await chatsService.listThreadMessages(userId, chatId, limit);
    return { messages };
  });
}

export async function getMessageMedia(c: Context) {
  try {
    const userId = c.get("userId") as string;
    const messageId = c.req.param("messageId");
    const { buffer, mimetype } = await chatsService.downloadStoredMessageMedia(userId, messageId);
    return new Response(buffer, {
      status: 200,
      headers: {
        "Content-Type": mimetype,
        "Cache-Control": "private, max-age=120",
      },
    });
  } catch (e) {
    if (e instanceof ServiceError) {
      return c.json({ error: e.message }, e.statusCode as 400 | 404);
    }
    throw e;
  }
}
