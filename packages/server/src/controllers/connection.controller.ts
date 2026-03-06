import type { Context } from "hono";
import { handle } from "../lib/handle";
import * as connectionService from "../services/connection.service";

export async function initConnection(c: Context) {
  return handle(c, async () => {
    await connectionService.init();
    return { message: "WhatsApp initializing" };
  });
}

export async function getStatus(c: Context) {
  return c.json(connectionService.getStatus());
}

export async function disconnect(c: Context) {
  return handle(c, async () => {
    await connectionService.disconnect();
    return { message: "Disconnected" };
  });
}
