import type { Context } from "hono";
import { handle } from "../lib/handle";
import * as messageService from "../services/message.service";

export async function sendMessage(c: Context) {
  return handle(c, async () => {
    const { phone, message } = await c.req.json<{ phone: string; message: string }>();
    await messageService.sendMessage(phone, message);
    return { message: "Sent" };
  });
}
