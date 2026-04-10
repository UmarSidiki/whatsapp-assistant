import { logger } from "../../../core/logger";
import { requireConnectedFor, resolveOutgoingJid, getSocketFor } from "../../whatsapp/services";
import { sendSegmented } from "./segment";
import { db } from "../../../database";
import { messageLog } from "../../../database";

export type OutgoingMediaKind = "image" | "video" | "audio" | "voice";

// ─── Message ──────────────────────────────────────────────────────────────────

/** Send a single text message (with human-like segmentation) and log it. */
export async function sendMessage(userId: string, phone: string, text: string): Promise<void> {
  requireConnectedFor(userId);
  const jid = resolveOutgoingJid(phone);
  try {
    await sendSegmented(userId, jid, text);
    await db.insert(messageLog).values({
      id: crypto.randomUUID(), userId, type: "single", phone, message: text,
      status: "sent", createdAt: new Date(),
    });
    logger.info("Message sent", { userId, phone });
  } catch (e) {
    await db.insert(messageLog).values({
      id: crypto.randomUUID(), userId, type: "single", phone, message: text,
      status: "failed", error: String(e), createdAt: new Date(),
    });
    throw e;
  }
}

export async function sendMediaMessage(
  userId: string,
  target: string,
  kind: OutgoingMediaKind,
  buffer: Buffer,
  mimeFromUpload: string,
  caption?: string
): Promise<void> {
  requireConnectedFor(userId);
  const jid = resolveOutgoingJid(target);
  if (!jid) {
    throw new Error("Invalid target JID");
  }
  const sock = getSocketFor(userId);
  const cap = caption?.trim() ? caption.trim() : undefined;

  if (kind === "image") {
    await sock.sendMessage(jid, { image: buffer, caption: cap });
  } else if (kind === "video") {
    await sock.sendMessage(jid, { video: buffer, caption: cap });
  } else if (kind === "voice") {
    await sock.sendMessage(jid, {
      audio: buffer,
      mimetype: "audio/ogg; codecs=opus",
      ptt: true,
    });
  } else {
    await sock.sendMessage(jid, {
      audio: buffer,
      mimetype: mimeFromUpload || "audio/mpeg",
      ptt: false,
    });
  }

  logger.info("Media message sent", { userId, kind, jid });
}
