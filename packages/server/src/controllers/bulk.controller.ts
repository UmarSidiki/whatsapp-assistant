import type { Context } from "hono";
import { handle } from "../lib/handle";
import * as bulkService from "../services/bulk.service";
import type { BulkContact } from "../services/bulk.service";

export async function startBulkSend(c: Context) {
  return handle(c, async () => {
    const body = await c.req.json<{
      contacts: BulkContact[];
      messageTemplate: string;
      antiBan: boolean;
      minDelay?: number;
      maxDelay?: number;
    }>();
    await bulkService.startBulkSend(body);
    return { message: "Bulk send started", total: body.contacts.length };
  });
}

export function getBulkStatus(c: Context) {
  return c.json(bulkService.getBulkStatus());
}

export function stopBulk(c: Context) {
  bulkService.stopBulk();
  return c.json({ message: "Stopped" });
}
