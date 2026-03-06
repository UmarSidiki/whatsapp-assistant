import { logger } from "../lib/logger";
import { requireConnectedFor, toJid, ServiceError } from "./wa-socket";
import { sendSegmented } from "./segment.service";
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
  userId: string;
  contacts: BulkContact[];
  messageTemplate: string;
  antiBan: boolean;
  minDelay?: number;
  maxDelay?: number;
}

// ─── State (per-user) ─────────────────────────────────────────────────────────

const bulkJobs = new Map<string, BulkJob>();

// ─── Helpers ──────────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const rand = (min: number, max: number) =>
  Math.floor(Math.random() * (max - min + 1)) + min;

const interpolate = (tpl: string, vars: Record<string, string>) =>
  tpl.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? `{${k}}`);

// ─── Bulk send ────────────────────────────────────────────────────────────────

/** Start sending messages to all contacts. Runs in the background. */
export async function startBulkSend(params: BulkSendParams): Promise<void> {
  const { userId, contacts, messageTemplate, antiBan, minDelay = 3000, maxDelay = 10000 } = params;
  requireConnectedFor(userId);
  if (bulkJobs.get(userId)?.running) throw new ServiceError("A bulk job is already running", 409);

  const job: BulkJob = { total: contacts.length, sent: 0, failed: 0, running: true, errors: [] };
  bulkJobs.set(userId, job);

  (async () => {
    for (const contact of contacts) {
      if (!job.running) break;
      const text = interpolate(messageTemplate, contact);
      const jid = toJid(contact.phone);
      try {
        await sendSegmented(userId, jid, text);
        await db.insert(messageLog).values({
          id: crypto.randomUUID(), userId, type: "bulk", phone: contact.phone,
          message: text, status: "sent", createdAt: new Date(),
        });
        job.sent++;
        logger.info("Bulk sent", { userId, phone: contact.phone });
      } catch (e) {
        await db.insert(messageLog).values({
          id: crypto.randomUUID(), userId, type: "bulk", phone: contact.phone,
          message: text, status: "failed", error: String(e), createdAt: new Date(),
        });
        job.failed++;
        job.errors.push({ phone: contact.phone, error: String(e) });
        logger.error("Bulk failed", { userId, phone: contact.phone, error: String(e) });
      }
      if (antiBan && job.running) await sleep(rand(minDelay, maxDelay));
    }
    job.running = false;
    logger.info("Bulk send complete", { userId, sent: job.sent, failed: job.failed });
  })();
}

export function getBulkStatus(userId: string): BulkJob {
  return bulkJobs.get(userId) ?? { total: 0, sent: 0, failed: 0, running: false, errors: [] };
}

export function stopBulk(userId: string): void {
  const job = bulkJobs.get(userId);
  if (job) job.running = false;
}
