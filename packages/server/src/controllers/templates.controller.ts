import type { Context } from "hono";
import { handle } from "../lib/handle";
import { ServiceError } from "../services/wa-socket";
import * as templatesService from "../services/templates.service";

export async function getTemplates(c: Context) {
  const userId = c.get("userId") as string;
  return c.json(await templatesService.getTemplates(userId));
}

export async function createTemplate(c: Context) {
  return handle(c, async () => {
    const userId = c.get("userId") as string;
    const { name, content } = await c.req.json<{ name: string; content: string }>();
    return templatesService.createTemplate(userId, name, content);
  }, 201);
}

export async function deleteTemplate(c: Context) {
  return handle(c, async () => {
    const userId = c.get("userId") as string;
    const id = c.req.param("id");
    if (!id) throw new ServiceError("Missing id parameter", 400);
    await templatesService.deleteTemplate(userId, id);
    return { message: "Deleted" };
  });
}
