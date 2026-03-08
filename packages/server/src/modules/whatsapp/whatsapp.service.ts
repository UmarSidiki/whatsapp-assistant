import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  type WASocket,
} from "@whiskeysockets/baileys";
import { logger } from "../../core/logger";

// ─── Types ────────────────────────────────────────────────────────────────────

export type WAStatus = "idle" | "waiting_qr" | "connected" | "disconnected";

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

export interface ScheduledMessage {
  id: string;
  phone: string;
  message: string;
  scheduledAt: string;
  status: "pending" | "sent" | "failed";
}

export interface AutoReplyRule {
  id: string;
  keyword: string;
  response: string;
  matchType: "exact" | "contains" | "startsWith";
  enabled: boolean;
}

export interface BulkSendParams {
  contacts: BulkContact[];
  messageTemplate: string;
  antiBan: boolean;
  minDelay?: number;
  maxDelay?: number;
}

/** Business-logic error with an associated HTTP status code. */
export class ServiceError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number = 400
  ) {
    super(message);
    this.name = "ServiceError";
  }
}

// ─── Silent Baileys logger ────────────────────────────────────────────────────
const silentLogger = {
  level: "silent",
  trace: () => {},
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  fatal: () => {},
  child: function () { return this; },
} as unknown as Parameters<typeof makeWASocket>[0]["logger"];

// ─── Helpers ──────────────────────────────────────────────────────────────────
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const rand = (min: number, max: number) =>
  Math.floor(Math.random() * (max - min + 1)) + min;

/** Normalise a phone number to a WhatsApp JID (individual contacts only). */
const toJid = (phone: string) => phone.replace(/\D/g, "") + "@s.whatsapp.net";

/** Replace {variable} placeholders in a template. */
const interpolate = (tpl: string, vars: Record<string, string>) =>
  tpl.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? `{${k}}`);

/** Returns true only for individual-contact JIDs (not groups, status, broadcast). */
const isIndividualJid = (jid: string) =>
  jid.endsWith("@s.whatsapp.net") &&
  !jid.startsWith("status@") &&
  !jid.startsWith("broadcast@");

// ─── WhatsApp Service ─────────────────────────────────────────────────────────

class WhatsAppService {
  private status: WAStatus = "idle";
  private qr: string | undefined = undefined;
  private socket: WASocket | null = null;

  private bulkJob: BulkJob | null = null;

  private scheduled: ScheduledMessage[] = [];
  private scheduleTimers = new Map<string, ReturnType<typeof setTimeout>>();

  private autoReplies: AutoReplyRule[] = [];

  // ── Connection ──────────────────────────────────────────────────────────────

  async init(): Promise<void> {
    if (this.socket && (this.status === "waiting_qr" || this.status === "connected")) {
      return; // already active
    }
    logger.info("WhatsApp initializing");

    const { state, saveCreds } = await useMultiFileAuthState("./wa-auth");
    this.status = "waiting_qr";
    this.qr = undefined;

    const sock = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      logger: silentLogger,
    });
    this.socket = sock;

    sock.ev.on("connection.update", ({ connection, lastDisconnect, qr }) => {
      if (qr) {
        this.qr = qr;
        this.status = "waiting_qr";
        logger.info("QR code generated");
      }
      if (connection === "open") {
        this.status = "connected";
        this.qr = undefined;
        logger.info("WhatsApp connected");
      }
      if (connection === "close") {
        const code = (
          lastDisconnect?.error as { output?: { statusCode?: number } }
        )?.output?.statusCode;
        const loggedOut = code === DisconnectReason.loggedOut;
        this.status = loggedOut ? "disconnected" : "waiting_qr";
        this.socket = null;
        if (loggedOut) this.qr = undefined;
        logger.info("WhatsApp connection closed", { code, loggedOut });
      }
    });

    // Listen for incoming messages — individual contacts only
    sock.ev.on("messages.upsert", async ({ messages, type }) => {
      if (type !== "notify") return;
      for (const msg of messages) {
        if (msg.key.fromMe) continue;
        const jid = msg.key.remoteJid ?? "";
        if (!isIndividualJid(jid)) continue; // skip groups, status, broadcasts

        const text =
          msg.message?.conversation ||
          msg.message?.extendedTextMessage?.text ||
          "";
        if (!text) continue;

        await this._handleAutoReply(jid, text);
      }
    });

    sock.ev.on("creds.update", saveCreds);
  }

  async disconnect(): Promise<void> {
    if (this.socket) {
      try { await this.socket.logout(); } catch { this.socket?.end(undefined); }
      this.socket = null;
    }
    this.status = "idle";
    this.qr = undefined;
    logger.info("WhatsApp disconnected");
  }

  getStatus(): { status: WAStatus; qr?: string } {
    return { status: this.status, qr: this.qr };
  }

  // ── Single message ──────────────────────────────────────────────────────────

  async sendMessage(phone: string, text: string): Promise<void> {
    this._requireConnected();
    await this.socket!.sendMessage(toJid(phone), { text });
    logger.info("Message sent", { phone });
  }

  // ── Bulk send ───────────────────────────────────────────────────────────────

  async startBulkSend(params: BulkSendParams): Promise<void> {
    this._requireConnected();
    if (this.bulkJob?.running) {
      throw new ServiceError("A bulk job is already running", 409);
    }

    const { contacts, messageTemplate, antiBan, minDelay = 3000, maxDelay = 10000 } = params;
    this.bulkJob = { total: contacts.length, sent: 0, failed: 0, running: true, errors: [] };

    // Fire-and-forget
    (async () => {
      for (const contact of contacts) {
        if (!this.bulkJob!.running) break;
        const text = interpolate(messageTemplate, contact);
        try {
          await this.socket!.sendMessage(toJid(contact.phone), { text });
          this.bulkJob!.sent++;
          logger.info("Bulk sent", { phone: contact.phone });
        } catch (e) {
          this.bulkJob!.failed++;
          this.bulkJob!.errors.push({ phone: contact.phone, error: String(e) });
          logger.error("Bulk failed", { phone: contact.phone, error: String(e) });
        }
        if (antiBan && this.bulkJob!.running) {
          await sleep(rand(minDelay, maxDelay));
        }
      }
      if (this.bulkJob) this.bulkJob.running = false;
      logger.info("Bulk send complete", {
        sent: this.bulkJob?.sent,
        failed: this.bulkJob?.failed,
      });
    })();
  }

  getBulkStatus(): BulkJob {
    return this.bulkJob ?? { total: 0, sent: 0, failed: 0, running: false, errors: [] };
  }

  stopBulk(): void {
    if (this.bulkJob) this.bulkJob.running = false;
  }

  // ── Schedule ────────────────────────────────────────────────────────────────

  getScheduledMessages(): ScheduledMessage[] {
    return this.scheduled;
  }

  addScheduledMessage(phone: string, message: string, scheduledAt: string): ScheduledMessage {
    const msg: ScheduledMessage = {
      id: crypto.randomUUID(),
      phone, message, scheduledAt, status: "pending",
    };
    this.scheduled.push(msg);
    this._dispatchScheduled(msg);
    return msg;
  }

  cancelScheduledMessage(id: string): void {
    const idx = this.scheduled.findIndex((m) => m.id === id);
    if (idx === -1) throw new ServiceError("Scheduled message not found", 404);
    const timer = this.scheduleTimers.get(id);
    if (timer) { clearTimeout(timer); this.scheduleTimers.delete(id); }
    this.scheduled.splice(idx, 1);
  }

  // ── Auto-reply ──────────────────────────────────────────────────────────────

  getAutoReplyRules(): AutoReplyRule[] {
    return this.autoReplies;
  }

  addAutoReplyRule(
    keyword: string,
    response: string,
    matchType: AutoReplyRule["matchType"] = "contains"
  ): AutoReplyRule {
    const rule: AutoReplyRule = {
      id: crypto.randomUUID(),
      keyword, response, matchType, enabled: true,
    };
    this.autoReplies.push(rule);
    return rule;
  }

  updateAutoReplyRule(id: string, data: Partial<AutoReplyRule>): AutoReplyRule {
    const rule = this.autoReplies.find((r) => r.id === id);
    if (!rule) throw new ServiceError("Auto-reply rule not found", 404);
    Object.assign(rule, data);
    return rule;
  }

  deleteAutoReplyRule(id: string): void {
    const idx = this.autoReplies.findIndex((r) => r.id === id);
    if (idx === -1) throw new ServiceError("Auto-reply rule not found", 404);
    this.autoReplies.splice(idx, 1);
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private _requireConnected(): void {
    if (!this.socket || this.status !== "connected") {
      throw new ServiceError("WhatsApp is not connected", 400);
    }
  }

  private _dispatchScheduled(msg: ScheduledMessage): void {
    const delay = new Date(msg.scheduledAt).getTime() - Date.now();
    const run = async () => {
      if (!this.socket || this.status !== "connected") {
        msg.status = "failed";
        logger.warn("Scheduled message failed — not connected", { id: msg.id });
        return;
      }
      try {
        await this.socket.sendMessage(toJid(msg.phone), { text: msg.message });
        msg.status = "sent";
        logger.info("Scheduled message sent", { id: msg.id });
      } catch (e) {
        msg.status = "failed";
        logger.error("Scheduled message failed", { id: msg.id, error: String(e) });
      }
      this.scheduleTimers.delete(msg.id);
    };
    if (delay <= 0) run();
    else this.scheduleTimers.set(msg.id, setTimeout(run, delay));
  }

  private async _handleAutoReply(jid: string, text: string): Promise<void> {
    const t = text.toLowerCase();
    for (const rule of this.autoReplies) {
      if (!rule.enabled) continue;
      const k = rule.keyword.toLowerCase();
      const hit =
        (rule.matchType === "exact" && t === k) ||
        (rule.matchType === "contains" && t.includes(k)) ||
        (rule.matchType === "startsWith" && t.startsWith(k));
      if (hit) {
        await this.socket?.sendMessage(jid, { text: rule.response });
        logger.info("Auto-reply sent", { jid, keyword: rule.keyword });
        break; // first matching rule wins
      }
    }
  }
}

// Export a singleton instance
export const whatsappService = new WhatsAppService();
