import type { Context } from "hono";
import { handle } from "../../../core/utils";
import { ServiceError } from "../types";
import * as chatsService from "../services/chats";

function parsePositiveInt(value: string | undefined, fallback: number, max: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

function parseNonNegativeInt(value: string | undefined, fallback: number, max: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.min(parsed, max);
}

export async function getChats(c: Context) {
  return handle(c, async () => {
    const userId = c.get("userId") as string;
    const scope = chatsService.parseChatsScope(c.req.query("type"));
    return { chats: await chatsService.getChats(userId, scope) };
  });
}

export async function getChatsBootstrap(c: Context) {
  return handle(c, async () => {
    const userId = c.get("userId") as string;
    const scope = chatsService.parseChatsScope(c.req.query("type"));
    const chatLimit = parsePositiveInt(c.req.query("chatLimit"), 50, 100);
    const threadLimit = parsePositiveInt(c.req.query("threadLimit"), 20, 100);
    const offset = parseNonNegativeInt(c.req.query("offset"), 0, 5000);

    const bootstrap = await chatsService.getChatBootstrap(userId, scope, chatLimit, threadLimit, offset);
    return {
      ...bootstrap,
      chatLimit,
      threadLimit,
      offset,
    };
  });
}

export async function getChatMessages(c: Context) {
  return handle(c, async () => {
    const userId = c.get("userId") as string;
    const chatId = decodeURIComponent(c.req.param("chatId"));
    const limit = parsePositiveInt(c.req.query("limit"), 20, 100);
    const cursor = c.req.query("cursor") || undefined;

    return chatsService.listThreadMessagesPage(userId, chatId, {
      limit,
      cursor,
    });
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
      return c.json({ error: e.message }, e.statusCode as any);
    }
    throw e;
  }
}
