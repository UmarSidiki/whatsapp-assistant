import { logger } from "../lib/logger";
import { ServiceError, getSocketFor } from "./wa-socket";
import { sendSegmented } from "./segment.service";
import { db } from "../db";
import { autoReplyRule, messageLog } from "../db/schema";
import { eq, and } from "drizzle-orm";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AutoReplyRule {
  id: string;
  keyword: string;
  response: string;
  matchType: "exact" | "contains" | "startsWith";
  enabled: boolean;
}

// ─── Auto-reply ───────────────────────────────────────────────────────────────

/** Get all auto-reply rules for a user from the database. */
export async function getAutoReplyRules(userId: string): Promise<AutoReplyRule[]> {
  return db.select().from(autoReplyRule)
    .where(eq(autoReplyRule.userId, userId))
    .all() as unknown as AutoReplyRule[];
}

/** Add a new auto-reply rule and persist it. */
export async function addAutoReplyRule(
  userId: string,
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
  await db.insert(autoReplyRule).values({ ...rule, userId, createdAt: now, updatedAt: now });
  return rule;
}

/** Update an existing rule. Throws 404 if not found. */
export async function updateAutoReplyRule(
  userId: string,
  id: string,
  data: Partial<AutoReplyRule>
): Promise<AutoReplyRule> {
  const [existing] = await db.select().from(autoReplyRule)
    .where(and(eq(autoReplyRule.id, id), eq(autoReplyRule.userId, userId)));
  if (!existing) throw new ServiceError("Auto-reply rule not found", 404);
  await db.update(autoReplyRule)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(autoReplyRule.id, id));
  return { ...existing, ...data } as AutoReplyRule;
}

/** Delete a rule. Throws 404 if not found. */
export async function deleteAutoReplyRule(userId: string, id: string): Promise<void> {
  const [existing] = await db.select().from(autoReplyRule)
    .where(and(eq(autoReplyRule.id, id), eq(autoReplyRule.userId, userId)));
  if (!existing) throw new ServiceError("Auto-reply rule not found", 404);
  await db.delete(autoReplyRule).where(eq(autoReplyRule.id, id));
}

// ─── Internal ─────────────────────────────────────────────────────────────────

/**
 * Called by the connection service for every incoming individual message.
 * Sends a reply (segmented) if the message matches the first enabled rule.
 */
export async function handleAutoReply(userId: string, jid: string, text: string): Promise<void> {
  const rules = await getAutoReplyRules(userId);
  const t = text.toLowerCase();

  for (const rule of rules) {
    if (!rule.enabled) continue;
    const k = rule.keyword.toLowerCase();
    const matches =
      (rule.matchType === "exact" && t === k) ||
      (rule.matchType === "contains" && t.includes(k)) ||
      (rule.matchType === "startsWith" && t.startsWith(k));

    if (matches) {
      try {
        await sendSegmented(userId, jid, rule.response);
        const phone = jid.replace("@s.whatsapp.net", "");
        await db.insert(messageLog).values({
          id: crypto.randomUUID(), userId, type: "auto_reply", phone,
          message: rule.response, status: "sent", createdAt: new Date(),
        });
        logger.info("Auto-reply sent", { userId, jid, keyword: rule.keyword });
      } catch (e) {
        logger.error("Auto-reply failed", { userId, jid, error: String(e) });
      }
      break; // first matching rule wins
    }
  }
}
