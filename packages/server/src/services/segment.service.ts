import { logger } from "../lib/logger";
import { getSocketFor, toJid } from "./wa-socket";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const rand = (min: number, max: number) =>
  Math.floor(Math.random() * (max - min + 1)) + min;

// ─── Split message into human-like segments ───────────────────────────────────

/**
 * Split a message into natural segments that mimic human typing.
 * Rules:
 *  - Messages ≤ 200 chars → single message
 *  - Split on double newlines first (natural paragraph breaks)
 *  - Then on sentence boundaries
 *  - Merge tiny segments with neighbors
 *  - Max ~350 chars per segment
 */
export function segmentMessage(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.length <= 200) return [trimmed];

  const segments: string[] = [];

  // Try splitting on double newlines first
  const paragraphs = trimmed.split(/\n\n+/);
  if (paragraphs.length > 1) {
    for (const para of paragraphs) {
      const p = para.trim();
      if (!p) continue;
      if (segments.length > 0 && segments[segments.length - 1].length + p.length < 250) {
        segments[segments.length - 1] += "\n\n" + p;
      } else if (p.length > 350) {
        // Further split long paragraphs on sentences
        segments.push(...splitOnSentences(p));
      } else {
        segments.push(p);
      }
    }
    return segments.length > 0 ? segments : [trimmed];
  }

  // No double newlines → split on single newlines
  const lines = trimmed.split(/\n/);
  if (lines.length > 2) {
    for (const line of lines) {
      const l = line.trim();
      if (!l) continue;
      if (segments.length > 0 && segments[segments.length - 1].length + l.length < 250) {
        segments[segments.length - 1] += "\n" + l;
      } else {
        segments.push(l);
      }
    }
    return segments.length > 0 ? segments : [trimmed];
  }

  // No newlines → split on sentences
  return splitOnSentences(trimmed);
}

function splitOnSentences(text: string): string[] {
  // Match sentence endings: .!? followed by space and capital letter, or end of string
  const sentences = text.match(/[^.!?]+[.!?]+[\s]*/g) || [text];
  const segments: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    const s = sentence.trim();
    if (!s) continue;
    if (current.length + s.length < 300) {
      current = current ? current + " " + s : s;
    } else {
      if (current) segments.push(current.trim());
      current = s;
    }
  }
  if (current.trim()) segments.push(current.trim());

  return segments.length > 0 ? segments : [text];
}

// ─── Send segmented message with human-like delays ────────────────────────────

/**
 * Send a message in human-like segments with typing simulation.
 * - Sends "composing" presence before each segment
 * - Waits a random delay (proportional to segment length) between segments
 * - Returns all segments that were sent
 */
export async function sendSegmented(
  userId: string,
  jid: string,
  text: string
): Promise<string[]> {
  const socket = getSocketFor(userId);
  const segments = segmentMessage(text);

  for (let i = 0; i < segments.length; i++) {
    // Show typing indicator
    try {
      await socket.sendPresenceUpdate("composing", jid);
    } catch {
      // Presence update is best-effort
    }

    // Wait a human-like delay based on segment length (40-80ms per char, min 800ms, max 4000ms)
    if (i > 0) {
      const typingDelay = Math.min(4000, Math.max(800, segments[i].length * rand(40, 80)));
      await sleep(typingDelay);
    } else if (segments.length > 1) {
      // Brief initial delay for first segment
      await sleep(rand(300, 800));
    }

    // Send the segment
    await socket.sendMessage(jid, { text: segments[i] });

    // Clear typing indicator
    try {
      await socket.sendPresenceUpdate("paused", jid);
    } catch {
      // Best-effort
    }

    // Small gap between segments
    if (i < segments.length - 1) {
      await sleep(rand(500, 1500));
    }
  }

  logger.info("Segmented message sent", { userId, jid, segmentCount: segments.length });
  return segments;
}

// ─── Batch incoming rapid messages ────────────────────────────────────────────

const incomingBuffers = new Map<string, { messages: string[]; timer: ReturnType<typeof setTimeout> }>();

/**
 * Buffer rapidly arriving messages from the same contact and combine them.
 * Calls the handler with the combined message after a quiet period (2s).
 */
export function bufferIncomingMessage(
  key: string,
  text: string,
  handler: (combinedText: string) => Promise<void>,
  quietPeriodMs: number = 6500
): void {
  const existing = incomingBuffers.get(key);

  if (existing) {
    clearTimeout(existing.timer);
    existing.messages.push(text);
  } else {
    incomingBuffers.set(key, { messages: [text], timer: null as any });
  }

  const buffer = incomingBuffers.get(key)!;
  buffer.timer = setTimeout(async () => {
    const combined = buffer.messages.join("\n");
    incomingBuffers.delete(key);
    try {
      await handler(combined);
    } catch (e) {
      logger.error("Buffered message handler failed", { key, error: String(e) });
    }
  }, quietPeriodMs);
}
