import { logger } from "../../core/logger";
import { requireConnectedFor, toJid } from "../whatsapp/wa-socket";
import { sendSegmented } from "./segment.service";
import { db } from "../../database";
import { messageLog } from "../../database/schema";

// ─── Message ──────────────────────────────────────────────────────────────────

/** Send a single text message (with human-like segmentation) and log it. */
export async function sendMessage(userId: string, phone: string, text: string): Promise<void> {
  requireConnectedFor(userId);
  const jid = toJid(phone);
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
