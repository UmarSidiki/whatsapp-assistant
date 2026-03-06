import { logger } from "../lib/logger";
import { wa, ServiceError } from "./wa-socket";
import { db } from "../db";
import { autoReplyRule } from "../db/schema";
import { eq } from "drizzle-orm";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AutoReplyRule {
  id: string;
  keyword: string;
  response: string;
  matchType: "exact" | "contains" | "startsWith";
  enabled: boolean;
}

// ─── Auto-reply ───────────────────────────────────────────────────────────────

/** Get all auto-reply rules from the database. */
export async function getAutoReplyRules(): Promise<AutoReplyRule[]> {
  return db.select().from(autoReplyRule).all() as AutoReplyRule[];
}

/** Add a new auto-reply rule and persist it. */
export async function addAutoReplyRule(
  keyword: string,
  response: string,
  matchType: AutoReplyRule["matchType"] = "contains"
): Promise<AutoReplyRule> {
  const now = new Date();
  const rule: AutoReplyRule = {
    id: crypto.randomUUID(),
    keyword,
    response,
    matchType,
    enabled: true,
  };
  await db.insert(autoReplyRule).values({ ...rule, createdAt: now, updatedAt: now });
  return rule;
}

/** Update an existing rule. Throws 404 if not found. */
export async function updateAutoReplyRule(
  id: string,
  data: Partial<AutoReplyRule>
): Promise<AutoReplyRule> {
  const [existing] = await db.select().from(autoReplyRule).where(eq(autoReplyRule.id, id));
  if (!existing) throw new ServiceError("Auto-reply rule not found", 404);
  await db.update(autoReplyRule)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(autoReplyRule.id, id));
  return { ...existing, ...data } as AutoReplyRule;
}

/** Delete a rule. Throws 404 if not found. */
export async function deleteAutoReplyRule(id: string): Promise<void> {
  const [existing] = await db.select().from(autoReplyRule).where(eq(autoReplyRule.id, id));
  if (!existing) throw new ServiceError("Auto-reply rule not found", 404);
  await db.delete(autoReplyRule).where(eq(autoReplyRule.id, id));
}

// ─── Internal ─────────────────────────────────────────────────────────────────

/**
 * Called by the connection service for every incoming individual message.
 * Sends a reply if the message matches the first enabled rule.
 */
export async function handleAutoReply(jid: string, text: string): Promise<void> {
  const rules = await getAutoReplyRules();
  const t = text.toLowerCase();

  for (const rule of rules) {
    if (!rule.enabled) continue;
    const k = rule.keyword.toLowerCase();
    const matches =
      (rule.matchType === "exact" && t === k) ||
      (rule.matchType === "contains" && t.includes(k)) ||
      (rule.matchType === "startsWith" && t.startsWith(k));

    if (matches) {
      await wa.socket?.sendMessage(jid, { text: rule.response });
      logger.info("Auto-reply sent", { jid, keyword: rule.keyword });
      break; // first matching rule wins
    }
  }
}
