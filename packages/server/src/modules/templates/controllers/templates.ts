import type { Context } from "hono";
import { handle } from "../../../core/utils";
import { ServiceError } from "../../whatsapp/services";
import * as templatesService from "../services";

export async function getTemplates(c: Context) {
  const userId = c.get("userId") as string;
  const templates = await templatesService.getTemplates(userId);
  return c.json({ templates });
}

export async function createTemplate(c: Context) {
  return handle(c, async () => {
    const userId = c.get("userId") as string;
    const { name, content } = await c.req.json<{ name: string; content: string }>();
    const template = await templatesService.createTemplate(userId, name, content);
    return { template };
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
