import type { Context } from "hono";
import { handle } from "../../../core/utils";
import * as bulkService from "../services";
import type { BulkContact } from "../services";

export async function startBulkSend(c: Context) {
  return handle(c, async () => {
    const userId = c.get("userId") as string;
    const body = await c.req.json<{
      contacts: BulkContact[];
      messageTemplate: string;
      antiBan: boolean;
      minDelay?: number;
      maxDelay?: number;
    }>();
    await bulkService.startBulkSend({ userId, ...body });
    return { message: "Bulk send started", total: body.contacts.length };
  });
}

export function getBulkStatus(c: Context) {
  const userId = c.get("userId") as string;
  return c.json(bulkService.getBulkStatus(userId));
}

export function stopBulk(c: Context) {
  const userId = c.get("userId") as string;
  bulkService.stopBulk(userId);
  return c.json({ message: "Stopped" });
}
