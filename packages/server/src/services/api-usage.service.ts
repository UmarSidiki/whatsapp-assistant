import { db } from "../db";
import { aiApiUsage } from "../db/schema";
import { logger } from "../lib/logger";
import { ProviderError } from "../lib/ai-provider";
import { eq, and, gt, lt, count } from "drizzle-orm";

// ─── Rate Limit Configuration ─────────────────────────────────────────────

/** Rate limits per minute with 10% safety margin */
const RATE_LIMITS = {
  groq: 27, // 30 requests/min - 10% = 27
  gemini: 54, // 60 requests/min - 10% = 54
} as const;

/** Time window for rolling rate limit check (60 seconds) */
const RATE_LIMIT_WINDOW_MS = 60 * 1000;

/** Warning threshold (80% of rate limit) */
const WARNING_THRESHOLD = 0.8;

/** Auto-cleanup interval (5 minutes) */
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

// ─── Global State ─────────────────────────────────────────────────────────

/** Debounced cleanup timer */
let cleanupTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Debounced cleanup function to avoid running too frequently
 */
function scheduleCleanup(): void {
  if (cleanupTimer) clearTimeout(cleanupTimer);
  cleanupTimer = setTimeout(cleanupOldEntries, CLEANUP_INTERVAL_MS);
}

/**
 * Remove entries older than 60 seconds from database
 */
async function cleanupOldEntries(): Promise<void> {
  try {
    const now = new Date();
    await db
      .delete(aiApiUsage)
      .where(lt(aiApiUsage.resetAt, now))
      .run();
    logger.debug("API usage cleanup completed");
  } catch (error) {
    logger.error("API usage cleanup failed", { error: String(error) });
  }
}

// ─── Track API Call ───────────────────────────────────────────────────────

/**
 * Track an API call for rate limiting purposes
 * @param userId - User ID making the API call
 * @param provider - AI provider (groq or gemini)
 * @param model - Model being used
 */
export async function trackApiCall(
  userId: string,
  provider: "groq" | "gemini",
  model: string
): Promise<void> {
  if (!userId) throw new Error("userId is required");
  if (!provider) throw new Error("provider is required");
  if (!model) throw new Error("model is required");

  try {
    const now = new Date();
    const resetAt = new Date(now.getTime() + RATE_LIMIT_WINDOW_MS);

    await db.insert(aiApiUsage).values({
      id: crypto.randomUUID(),
      userId,
      provider,
      model,
      callCount: 1,
      resetAt,
      timestamp: now,
    });

    scheduleCleanup();
  } catch (error) {
    logger.error("Failed to track API call", {
      userId,
      provider,
      error: String(error),
    });
    throw error;
  }
}

// ─── Check Provider Availability ──────────────────────────────────────────

/**
 * Check if a provider is within rate limits for a user
 * @param userId - User ID
 * @param provider - AI provider (groq or gemini)
 * @returns true if provider is available (under rate limit), false otherwise
 */
export async function isProviderAvailable(
  userId: string,
  provider: "groq" | "gemini"
): Promise<boolean> {
  if (!userId) throw new Error("userId is required");
  if (!provider) throw new Error("provider is required");

  try {
    // Remove expired entries first
    const now = new Date();
    await db
      .delete(aiApiUsage)
      .where(and(eq(aiApiUsage.userId, userId), lt(aiApiUsage.resetAt, now)))
      .run();

    // Count calls in the last 60 seconds
    const result = await db
      .select({ calls: count() })
      .from(aiApiUsage)
      .where(
        and(
          eq(aiApiUsage.userId, userId),
          eq(aiApiUsage.provider, provider),
          gt(aiApiUsage.timestamp, cutoffTime)
        )
      )
      .execute();

    const callCount = result[0]?.calls ?? 0;
    const limit = RATE_LIMITS[provider];
    const isAvailable = callCount < limit;

    // Log warning if approaching limit
    if (isAvailable && callCount >= limit * WARNING_THRESHOLD) {
      const percentageUsed = (callCount / limit) * 100;
      logger.warn("Rate limit warning: approaching limit", {
        userId,
        provider,
        callCount,
        limit,
        percentageUsed: percentageUsed.toFixed(1),
      });
    }

    return isAvailable;
  } catch (error) {
    logger.error("Failed to check provider availability", {
      userId,
      provider,
      error: String(error),
    });
    // Be conservative on error: return false to trigger fallback
    return false;
  }
}

// ─── Get Best Available Provider ──────────────────────────────────────────

/**
 * Get the best available provider (primary if available, else fallback)
 * Returns primary provider or fallback, or throws error if both unavailable
 * @param userId - User ID
 * @param primaryProvider - Primary provider to try first
 * @param fallbackProvider - Optional fallback provider
 * @returns The best available provider (groq or gemini)
 * @throws ProviderError if both providers are over rate limits
 */
export async function getBestAvailableProvider(
  userId: string,
  primaryProvider: "groq" | "gemini",
  fallbackProvider?: "groq" | "gemini"
): Promise<"groq" | "gemini"> {
  if (!userId) throw new Error("userId is required");
  if (!primaryProvider) throw new Error("primaryProvider is required");

  try {
    // Check if primary is available
    const primaryAvailable = await isProviderAvailable(userId, primaryProvider);
    if (primaryAvailable) {
      return primaryProvider;
    }

    // Try fallback if provided
    if (fallbackProvider) {
      const fallbackAvailable = await isProviderAvailable(userId, fallbackProvider);
      if (fallbackAvailable) {
        logger.info("Switching to fallback provider", {
          userId,
          primaryProvider,
          fallbackProvider,
        });
        return fallbackProvider;
      }
    }

    // Both unavailable or no fallback
    const error = new ProviderError(
      `Rate limit exceeded for ${primaryProvider}${fallbackProvider ? ` and ${fallbackProvider}` : ""}`,
      429
    );
    logger.error("All providers over rate limit", {
      userId,
      primaryProvider,
      fallbackProvider,
    });
    throw error;
  } catch (error) {
    if (error instanceof ProviderError) {
      throw error;
    }
    logger.error("Failed to get best available provider", {
      userId,
      primaryProvider,
      error: String(error),
    });
    throw error;
  }
}

// ─── Get Usage Stats ──────────────────────────────────────────────────────

/**
 * Get current usage stats for all providers
 * @param userId - User ID
 * @returns Usage stats for groq and gemini
 */
export async function getUsageStats(
  userId: string
): Promise<{
  groq: { calls: number; resetAt: Date };
  gemini: { calls: number; resetAt: Date };
}> {
  if (!userId) throw new Error("userId is required");

  try {
    const cutoffTime = new Date(Date.now() - RATE_LIMIT_WINDOW_MS);

    // Get stats for both providers
    const groqStats = await db
      .select({
        calls: count(),
        resetAt: aiApiUsage.resetAt,
      })
      .from(aiApiUsage)
      .where(
        and(
          eq(aiApiUsage.userId, userId),
          eq(aiApiUsage.provider, "groq"),
          gt(aiApiUsage.timestamp, cutoffTime)
        )
      )
      .execute();

    const geminiStats = await db
      .select({
        calls: count(),
        resetAt: aiApiUsage.resetAt,
      })
      .from(aiApiUsage)
      .where(
        and(
          eq(aiApiUsage.userId, userId),
          eq(aiApiUsage.provider, "gemini"),
          gt(aiApiUsage.timestamp, cutoffTime)
        )
      )
      .execute();

    const groqData = groqStats[0] ?? { calls: 0, resetAt: new Date() };
    const geminiData = geminiStats[0] ?? { calls: 0, resetAt: new Date() };

    return {
      groq: {
        calls: groqData.calls,
        resetAt: groqData.resetAt || new Date(),
      },
      gemini: {
        calls: geminiData.calls,
        resetAt: geminiData.resetAt || new Date(),
      },
    };
  } catch (error) {
    logger.error("Failed to get usage stats", { userId, error: String(error) });
    throw error;
  }
}

// ─── Reset Usage Counters ─────────────────────────────────────────────────

/**
 * Reset usage counters for a user (typically called daily or when rate limit resets)
 * @param userId - User ID
 */
export async function resetUsageCounters(userId: string): Promise<void> {
  if (!userId) throw new Error("userId is required");

  try {
    // Delete all entries for this user
    await db.delete(aiApiUsage).where(eq(aiApiUsage.userId, userId)).run();
    logger.info("Usage counters reset", { userId });
  } catch (error) {
    logger.error("Failed to reset usage counters", {
      userId,
      error: String(error),
    });
    throw error;
  }
}
