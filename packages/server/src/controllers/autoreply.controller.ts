import type { Context } from "hono";
import { handle } from "../lib/handle";
import { ServiceError } from "../services/wa-socket";
import * as autoreplyService from "../services/autoreply.service";

export async function getAutoReplyRules(c: Context) {
  const userId = c.get("userId") as string;
  return c.json(await autoreplyService.getAutoReplyRules(userId));
}

export async function addAutoReplyRule(c: Context) {
  return handle(c, async () => {
    const userId = c.get("userId") as string;
    const { keyword, response, matchType } = await c.req.json<{
      keyword: string;
      response: string;
      matchType?: "exact" | "contains" | "startsWith";
    }>();
    return autoreplyService.addAutoReplyRule(userId, keyword, response, matchType);
  }, 201);
}

export async function updateAutoReplyRule(c: Context) {
  return handle(c, async () => {
    const userId = c.get("userId") as string;
    const id = c.req.param("id");
    if (!id) throw new ServiceError("Missing id parameter", 400);
    const body = await c.req.json();
    return autoreplyService.updateAutoReplyRule(userId, id, body);
  });
}

export async function deleteAutoReplyRule(c: Context) {
  return handle(c, async () => {
    const userId = c.get("userId") as string;
    const id = c.req.param("id");
    if (!id) throw new ServiceError("Missing id parameter", 400);
    await autoreplyService.deleteAutoReplyRule(userId, id);
    return { message: "Deleted" };
  });
}
