import type { Context } from "hono";
import { handle } from "../../../core/utils";
import { ServiceError } from "../../whatsapp/services";
import * as flowService from "../services";

export async function getFlows(c: Context) {
  const userId = c.get("userId") as string;
  return c.json(await flowService.getFlows(userId));
}

export async function getFlow(c: Context) {
  return handle(c, async () => {
    const userId = c.get("userId") as string;
    const id = c.req.param("id");
    if (!id) throw new ServiceError("Missing id parameter", 400);
    return flowService.getFlow(userId, id);
  });
}

export async function createFlow(c: Context) {
  return handle(c, async () => {
    const userId = c.get("userId") as string;
    const body = await c.req.json<{
      name: string;
      description?: string;
      flowData: flowService.FlowDefinition;
      priority?: number;
    }>();
    if (!body.name?.trim()) throw new ServiceError("Flow name is required", 400);
    if (!body.flowData?.nodes?.length) throw new ServiceError("Flow must have at least one node", 400);
    return flowService.createFlow(userId, body);
  }, 201);
}

export async function updateFlow(c: Context) {
  return handle(c, async () => {
    const userId = c.get("userId") as string;
    const id = c.req.param("id");
    if (!id) throw new ServiceError("Missing id parameter", 400);
    const body = await c.req.json();
    return flowService.updateFlow(userId, id, body);
  });
}

export async function deleteFlow(c: Context) {
  return handle(c, async () => {
    const userId = c.get("userId") as string;
    const id = c.req.param("id");
    if (!id) throw new ServiceError("Missing id parameter", 400);
    await flowService.deleteFlow(userId, id);
    return { message: "Deleted" };
  });
}

export async function sendCtaButtons(c: Context) {
  return handle(c, async () => {
    const userId = c.get("userId") as string;
    const body = await c.req.json<{
      phone: string;
      text: string;
      footer?: string;
      buttons: flowService.FlowButton[];
    }>();
    if (!body.phone?.trim()) throw new ServiceError("Phone number is required", 400);
    if (!body.text?.trim()) throw new ServiceError("Message text is required", 400);
    if (!body.buttons?.length) throw new ServiceError("At least one button is required", 400);

    const jid = body.phone.replace(/\D/g, "") + "@s.whatsapp.net";
    await flowService.sendCtaButtonMessage(userId, jid, body.text, body.footer, body.buttons);
    return { message: "Buttons sent" };
  });
}

export async function uploadFlowImage(c: Context) {
  return handle(c, async () => {
    const userId = c.get("userId") as string;
    const formData = await c.req.formData();
    const fileEntry = formData.get("file");
    if (!fileEntry || typeof fileEntry === "string") {
      throw new ServiceError("Image file is required", 400);
    }

    const file = fileEntry as File;
    const uploaded = await flowService.uploadFlowImage(userId, file);
    const origin = new URL(c.req.url).origin;
    return {
      ...uploaded,
      imageUrl: `${origin}${uploaded.imageUrl}`,
    };
  }, 201);
}

export async function getFlowImage(c: Context) {
  try {
    const userId = c.get("userId") as string;
    const assetId = c.req.param("assetId");
    if (!assetId) throw new ServiceError("Missing assetId parameter", 400);
    const asset = await flowService.getFlowImageAsset(userId, assetId);
    return c.body(asset.buffer, 200, {
      "content-type": asset.mimeType,
      "cache-control": "private, max-age=300",
    });
  } catch (e) {
    if (e instanceof ServiceError) {
      return c.json({ error: e.message }, e.statusCode as 400 | 404);
    }
    throw e;
  }
}
