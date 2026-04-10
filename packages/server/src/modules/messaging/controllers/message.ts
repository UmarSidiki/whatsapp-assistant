import type { Context } from "hono";
import { handle } from "../../../core/utils";
import { ServiceError } from "../../whatsapp/types";
import * as messageService from "../services";

export async function sendMessage(c: Context) {
  return handle(c, async () => {
    const userId = c.get("userId") as string;
    const body = await c.req.json<{ phone?: string; jid?: string; message: string }>();
    const target = (body.jid ?? body.phone ?? "").trim();
    if (!target) {
      throw new ServiceError("Missing phone or jid", 400);
    }
    await messageService.sendMessage(userId, target, body.message);
    return { message: "Sent" };
  });
}

export async function sendMedia(c: Context) {
  return handle(c, async () => {
    const userId = c.get("userId") as string;
    const body = await c.req.parseBody();
    const target = String(body.phone ?? body.jid ?? "").trim();
    const kind = String(body.type ?? "image").toLowerCase();
    const caption = typeof body.caption === "string" ? body.caption : "";
    const file = body.file;

    if (!target) {
      throw new ServiceError("Missing phone or jid", 400);
    }
    if (!file || typeof file === "string" || typeof (file as Blob).arrayBuffer !== "function") {
      throw new ServiceError("Missing file", 400);
    }

    const blob = file as File;
    const buf = Buffer.from(await blob.arrayBuffer());
    const allowed = new Set(["image", "video", "audio", "voice"]);
    if (!allowed.has(kind)) {
      throw new ServiceError("Invalid type (use image, video, audio, voice)", 400);
    }

    await messageService.sendMediaMessage(
      userId,
      target,
      kind as messageService.OutgoingMediaKind,
      buf,
      blob.type || "application/octet-stream",
      caption
    );
    return { message: "Sent" };
  });
}
