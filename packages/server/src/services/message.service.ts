import { logger } from "../lib/logger";
import { wa, requireConnected, toJid } from "./wa-socket";
import { db } from "../db";
import { messageLog } from "../db/schema";

// ─── Message ──────────────────────────────────────────────────────────────────

/** Send a single text message and log it to the database. */
export async function sendMessage(phone: string, text: string): Promise<void> {
  requireConnected();
  try {
    await wa.socket!.sendMessage(toJid(phone), { text });
    await db.insert(messageLog).values({
      id: crypto.randomUUID(), type: "single", phone, message: text,
      status: "sent", createdAt: new Date(),
    });
    logger.info("Message sent", { phone });
  } catch (e) {
    await db.insert(messageLog).values({
      id: crypto.randomUUID(), type: "single", phone, message: text,
      status: "failed", error: String(e), createdAt: new Date(),
    });
    throw e;
  }
}
