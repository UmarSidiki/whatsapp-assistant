import crypto from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db, waChatMessage } from "../database";

type Sender = "me" | "contact";

interface LoadTestOptions {
  userId: string;
  chats: number;
  messages: number;
  batchSize: number;
  duplicateReplay: number;
  clearBeforeRun: boolean;
}

const DEFAULTS: LoadTestOptions = {
  userId: "loadtest-user",
  chats: 50,
  messages: 100_000,
  batchSize: 1000,
  duplicateReplay: 10_000,
  clearBeforeRun: true,
};

function isMissingRelationError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth++) {
    if (
      typeof current === "object" &&
      current !== null &&
      "code" in current &&
      String((current as { code?: unknown }).code) === "42P01"
    ) {
      return true;
    }
    if (typeof current === "object" && current !== null && "cause" in current) {
      current = (current as { cause?: unknown }).cause;
      continue;
    }
    break;
  }

  return false;
}

function parsePositiveInt(value: string | undefined, fallback: number, min = 1): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < min) return fallback;
  return parsed;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (!value) return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
  return fallback;
}

function parseArgs(argv: string[]): LoadTestOptions {
  const args = new Map<string, string>();
  for (const entry of argv) {
    if (!entry.startsWith("--")) continue;
    const [rawKey, ...rest] = entry.slice(2).split("=");
    const key = rawKey.trim();
    const value = rest.join("=").trim();
    if (!key) continue;
    args.set(key, value);
  }

  return {
    userId: args.get("userId") || DEFAULTS.userId,
    chats: parsePositiveInt(args.get("chats"), DEFAULTS.chats),
    messages: parsePositiveInt(args.get("messages"), DEFAULTS.messages),
    batchSize: parsePositiveInt(args.get("batchSize"), DEFAULTS.batchSize),
    duplicateReplay: parsePositiveInt(args.get("duplicateReplay"), DEFAULTS.duplicateReplay, 0),
    clearBeforeRun: parseBoolean(args.get("clear"), DEFAULTS.clearBeforeRun),
  };
}

function buildContactPhone(chatIndex: number): string {
  return `923100${String(chatIndex).padStart(6, "0")}`;
}

function buildSyntheticRow(opts: LoadTestOptions, sequence: number) {
  const chatIndex = sequence % opts.chats;
  const contactPhone = buildContactPhone(chatIndex);
  const chatId = `${contactPhone}@s.whatsapp.net`;
  const sender: Sender = sequence % 2 === 0 ? "contact" : "me";
  const timestamp = new Date(Date.now() - (opts.messages - sequence) * 1000);
  const message = `loadtest message #${sequence} for chat ${chatIndex}`;
  const dedupeKey = `load:${chatId}:${sequence}`;

  return {
    id: crypto.randomUUID(),
    userId: opts.userId,
    chatId,
    chatType: "direct" as const,
    contactPhone,
    title: `LoadTest Chat ${chatIndex}`,
    message,
    sender,
    waMessageId: null,
    dedupeKey,
    source: "api" as const,
    timestamp,
    createdAt: new Date(),
    waMessagePayload: null,
    mediaKind: null,
  };
}

async function countLoadTestRows(userId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(waChatMessage)
    .where(
      and(
        eq(waChatMessage.userId, userId),
        sql`${waChatMessage.dedupeKey} LIKE 'load:%'`
      )
    );

  return Number(row?.count ?? 0);
}

async function clearPreviousRows(userId: string): Promise<void> {
  await db.delete(waChatMessage).where(
    and(
      eq(waChatMessage.userId, userId),
      sql`${waChatMessage.dedupeKey} LIKE 'load:%'`
    )
  );
}

async function insertRows(rows: Array<ReturnType<typeof buildSyntheticRow>>): Promise<void> {
  if (rows.length === 0) return;

  await db
    .insert(waChatMessage)
    .values(rows)
    .onConflictDoNothing({
      target: [waChatMessage.userId, waChatMessage.dedupeKey],
    });
}

async function runPrimaryIngestion(opts: LoadTestOptions): Promise<void> {
  for (let start = 0; start < opts.messages; start += opts.batchSize) {
    const end = Math.min(start + opts.batchSize, opts.messages);
    const rows: Array<ReturnType<typeof buildSyntheticRow>> = [];

    for (let seq = start; seq < end; seq++) {
      rows.push(buildSyntheticRow(opts, seq));
    }

    await insertRows(rows);

    const batchNumber = Math.floor(start / opts.batchSize) + 1;
    if (batchNumber % 20 === 0 || end === opts.messages) {
      console.log(`[loadtest] inserted batches: ${batchNumber}, rows attempted: ${end}/${opts.messages}`);
    }
  }
}

async function runDuplicateReplay(opts: LoadTestOptions): Promise<void> {
  if (opts.duplicateReplay <= 0) return;

  for (let start = 0; start < opts.duplicateReplay; start += opts.batchSize) {
    const end = Math.min(start + opts.batchSize, opts.duplicateReplay);
    const rows: Array<ReturnType<typeof buildSyntheticRow>> = [];

    for (let replaySeq = start; replaySeq < end; replaySeq++) {
      const sourceSeq = replaySeq % opts.messages;
      rows.push(buildSyntheticRow(opts, sourceSeq));
    }

    await insertRows(rows);
  }
}

function printConfig(opts: LoadTestOptions): void {
  console.log("[loadtest] configuration");
  console.log(JSON.stringify(opts, null, 2));
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  printConfig(opts);

  if (opts.clearBeforeRun) {
    console.log("[loadtest] clearing previous loadtest rows...");
    await clearPreviousRows(opts.userId);
  }

  const beforeCount = await countLoadTestRows(opts.userId);
  console.log(`[loadtest] rows before run: ${beforeCount}`);

  const ingestStartedAt = Date.now();
  await runPrimaryIngestion(opts);
  const ingestDurationMs = Date.now() - ingestStartedAt;

  const afterPrimaryCount = await countLoadTestRows(opts.userId);
  const insertedUnique = afterPrimaryCount - beforeCount;

  const replayStartedAt = Date.now();
  await runDuplicateReplay(opts);
  const replayDurationMs = Date.now() - replayStartedAt;

  const afterReplayCount = await countLoadTestRows(opts.userId);
  const replayInserted = afterReplayCount - afterPrimaryCount;
  const dedupeBlocked = Math.max(0, opts.duplicateReplay - replayInserted);

  const ingestSeconds = Math.max(ingestDurationMs / 1000, 0.001);
  const throughput = Math.round(insertedUnique / ingestSeconds);

  console.log("[loadtest] summary");
  console.log(`  unique inserted: ${insertedUnique}`);
  console.log(`  ingest duration: ${ingestDurationMs}ms`);
  console.log(`  ingest throughput: ${throughput} rows/sec`);
  console.log(`  duplicate replay attempted: ${opts.duplicateReplay}`);
  console.log(`  replay duration: ${replayDurationMs}ms`);
  console.log(`  replay inserted: ${replayInserted}`);
  console.log(`  dedupe blocked: ${dedupeBlocked}`);
  console.log(`  final loadtest row count: ${afterReplayCount}`);
}

main().catch((error) => {
  if (isMissingRelationError(error)) {
    console.error("[loadtest] wa_chat_message table is missing. Run database migrations first.");
    console.error("[loadtest] Suggested commands: npm run db:migrate --workspace server OR npm run db:push --workspace server");
    process.exitCode = 1;
    return;
  }

  console.error("[loadtest] failed", error);
  process.exitCode = 1;
});
