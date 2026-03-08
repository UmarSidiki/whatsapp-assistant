import type { Context } from "hono";
import { handle } from "../../core/handle";
import { ServiceError } from "../whatsapp/wa-socket";
import * as scheduleService from "./schedule.service";

export async function getScheduledMessages(c: Context) {
  const userId = c.get("userId") as string;
  return c.json(await scheduleService.getScheduledMessages(userId));
}

export async function addScheduledMessage(c: Context) {
  return handle(c, async () => {
    const userId = c.get("userId") as string;
    const { phone, message, scheduledAt } = await c.req.json<{
      phone: string; message: string; scheduledAt: string;
    }>();
    return scheduleService.addScheduledMessage(userId, phone, message, scheduledAt);
  }, 201);
}

export async function cancelScheduledMessage(c: Context) {
  return handle(c, async () => {
    const userId = c.get("userId") as string;
    const id = c.req.param("id");
    if (!id) throw new ServiceError("Missing id parameter", 400);
    await scheduleService.cancelScheduledMessage(userId, id);
    return { message: "Cancelled" };
  });
}
