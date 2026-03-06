import type { Context } from "hono";
import { handle } from "../lib/handle";
import { ServiceError } from "../services/wa-socket";
import * as templatesService from "../services/templates.service";

export async function getTemplates(c: Context) {
  return c.json(await templatesService.getTemplates());
}

export async function createTemplate(c: Context) {
  return handle(c, async () => {
    const { name, content } = await c.req.json<{ name: string; content: string }>();
    return templatesService.createTemplate(name, content);
  }, 201);
}

export async function deleteTemplate(c: Context) {
  return handle(c, async () => {
    const id = c.req.param("id");
    if (!id) throw new ServiceError("Missing id parameter", 400);
    await templatesService.deleteTemplate(id);
    return { message: "Deleted" };
  });
}
