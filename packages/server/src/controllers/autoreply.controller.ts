import type { Context } from "hono";
import { handle } from "../lib/handle";
import { ServiceError } from "../services/wa-socket";
import * as autoreplyService from "../services/autoreply.service";

export async function getAutoReplyRules(c: Context) {
  return c.json(await autoreplyService.getAutoReplyRules());
}

export async function addAutoReplyRule(c: Context) {
  return handle(c, async () => {
    const { keyword, response, matchType } = await c.req.json<{
      keyword: string;
      response: string;
      matchType?: "exact" | "contains" | "startsWith";
    }>();
    return autoreplyService.addAutoReplyRule(keyword, response, matchType);
  }, 201);
}

export async function updateAutoReplyRule(c: Context) {
  return handle(c, async () => {
    const id = c.req.param("id");
    if (!id) throw new ServiceError("Missing id parameter", 400);
    const body = await c.req.json();
    return autoreplyService.updateAutoReplyRule(id, body);
  });
}

export async function deleteAutoReplyRule(c: Context) {
  return handle(c, async () => {
    const id = c.req.param("id");
    if (!id) throw new ServiceError("Missing id parameter", 400);
    await autoreplyService.deleteAutoReplyRule(id);
    return { message: "Deleted" };
  });
}
