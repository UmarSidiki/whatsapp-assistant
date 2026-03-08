import type { Context } from "hono";
import { handle } from "../../core/handle";
import * as messageService from "./message.service";

export async function sendMessage(c: Context) {
  return handle(c, async () => {
    const userId = c.get("userId") as string;
    const { phone, message } = await c.req.json<{ phone: string; message: string }>();
    await messageService.sendMessage(userId, phone, message);
    return { message: "Sent" };
  });
}
