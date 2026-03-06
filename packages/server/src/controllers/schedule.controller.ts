import type { Context } from "hono";
import { handle } from "../lib/handle";
import { ServiceError } from "../services/wa-socket";
import * as scheduleService from "../services/schedule.service";

export async function getScheduledMessages(c: Context) {
  return c.json(await scheduleService.getScheduledMessages());
}

export async function addScheduledMessage(c: Context) {
  return handle(c, async () => {
    const { phone, message, scheduledAt } = await c.req.json<{
      phone: string; message: string; scheduledAt: string;
    }>();
    return scheduleService.addScheduledMessage(phone, message, scheduledAt);
  }, 201);
}

export async function cancelScheduledMessage(c: Context) {
  return handle(c, async () => {
    const id = c.req.param("id");
    if (!id) throw new ServiceError("Missing id parameter", 400);
    await scheduleService.cancelScheduledMessage(id);
    return { message: "Cancelled" };
  });
}
