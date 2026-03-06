import { logger } from "../lib/logger";
import { wa, requireConnected, toJid, ServiceError } from "./wa-socket";
import { db } from "../db";
import { messageLog } from "../db/schema";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BulkContact {
  phone: string;
  [key: string]: string;
}

export interface BulkJob {
  total: number;
  sent: number;
  failed: number;
  running: boolean;
  errors: Array<{ phone: string; error: string }>;
}

export interface BulkSendParams {
  contacts: BulkContact[];
  messageTemplate: string;
  antiBan: boolean;
  minDelay?: number;
  maxDelay?: number;
}

// ─── State ────────────────────────────────────────────────────────────────────

let bulkJob: BulkJob | null = null;

// ─── Helpers ──────────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const rand = (min: number, max: number) =>
  Math.floor(Math.random() * (max - min + 1)) + min;

const interpolate = (tpl: string, vars: Record<string, string>) =>
  tpl.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? `{${k}}`);

// ─── Bulk send ────────────────────────────────────────────────────────────────

/** Start sending messages to all contacts. Runs in the background. */
export async function startBulkSend(params: BulkSendParams): Promise<void> {
  requireConnected();
  if (bulkJob?.running) throw new ServiceError("A bulk job is already running", 409);

  const { contacts, messageTemplate, antiBan, minDelay = 3000, maxDelay = 10000 } = params;
  bulkJob = { total: contacts.length, sent: 0, failed: 0, running: true, errors: [] };

  (async () => {
    for (const contact of contacts) {
      if (!bulkJob!.running) break;
      const text = interpolate(messageTemplate, contact);
      try {
        await wa.socket!.sendMessage(toJid(contact.phone), { text });
        await db.insert(messageLog).values({
          id: crypto.randomUUID(), type: "bulk", phone: contact.phone,
          message: text, status: "sent", createdAt: new Date(),
        });
        bulkJob!.sent++;
        logger.info("Bulk sent", { phone: contact.phone });
      } catch (e) {
        await db.insert(messageLog).values({
          id: crypto.randomUUID(), type: "bulk", phone: contact.phone,
          message: text, status: "failed", error: String(e), createdAt: new Date(),
        });
        bulkJob!.failed++;
        bulkJob!.errors.push({ phone: contact.phone, error: String(e) });
        logger.error("Bulk failed", { phone: contact.phone, error: String(e) });
      }
      if (antiBan && bulkJob!.running) await sleep(rand(minDelay, maxDelay));
    }
    if (bulkJob) bulkJob.running = false;
    logger.info("Bulk send complete", { sent: bulkJob?.sent, failed: bulkJob?.failed });
  })();
}

export function getBulkStatus(): BulkJob {
  return bulkJob ?? { total: 0, sent: 0, failed: 0, running: false, errors: [] };
}

export function stopBulk(): void {
  if (bulkJob) bulkJob.running = false;
}
