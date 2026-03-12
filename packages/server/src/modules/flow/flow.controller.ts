import type { Context } from "hono";
import { handle } from "../../core/handle";
import { ServiceError } from "../whatsapp/wa-socket";
import * as flowService from "./flow.service";

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
