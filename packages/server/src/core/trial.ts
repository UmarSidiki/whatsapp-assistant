import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../database";
import { trialUsage, user } from "../database";
import { logger } from "./logger";

const TRIAL_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

export async function getTrialUsageByPhoneNumber(phoneNumber: string) {
  return db
    .select({ id: trialUsage.id, userId: trialUsage.userId })
    .from(trialUsage)
    .where(eq(trialUsage.phoneNumber, phoneNumber))
    .limit(1);
}

export async function getUserIdByEmail(email: string) {
  const rows = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, email))
    .limit(1);

  return rows[0]?.id ?? null;
}

export async function createTrialUsageRecord(phoneNumber: string, userId: string) {
  const now = new Date();
  const trialEndsAt = new Date(now.getTime() + TRIAL_DURATION_MS);

  try {
    await db.insert(trialUsage).values({
      id: randomUUID(),
      phoneNumber,
      userId,
      trialStartedAt: now,
      trialEndsAt,
      createdAt: now,
    });
  } catch (error) {
    logger.error("Failed to create trial usage record", {
      phoneNumber,
      userId,
      error,
    });
    throw error;
  }
}

export function normalizeTrialPhoneNumber(phoneNumber: string): string {
  return phoneNumber.replace(/\D/g, "");
}
