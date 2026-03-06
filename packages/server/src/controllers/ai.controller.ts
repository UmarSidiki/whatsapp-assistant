import type { Context } from "hono";
import { handle } from "../lib/handle";
import { ProviderError } from "../lib/ai-provider";
import * as aiResponseService from "../services/ai-response.service";
import * as aiPersonaService from "../services/ai-persona.service";
import * as aiAssistantService from "../services/ai-assistant.service";
import * as apiUsageService from "../services/api-usage.service";
import { db } from "../db";
import { aiSettings } from "../db/schema";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AISettingsData {
  aiEnabled: boolean;
  primaryProvider: "groq" | "gemini";
  fallbackProvider?: "groq" | "gemini";
}

// ─── Helper: Extract userId from Auth Cookie ───────────────────────────────────

/**
 * Extract userId from the auth session in Hono context
 * Assumes better-auth session is available in request headers
 */
function extractUserIdFromContext(c: Context): string | null {
  // Try to get from better-auth session - depends on how auth is configured
  // This is a placeholder that should be updated based on actual auth setup
  const userId = c.req.header("x-user-id");
  if (userId) return userId;
  
  // If auth middleware sets it on context variables
  const ctxUser = (c as any).var?.user;
  if (ctxUser?.id) return ctxUser.id;
  
  return null;
}

// ─── Endpoint Handlers ─────────────────────────────────────────────────────────

/**
 * POST /api/ai/response
 * Generate AI response for a message
 * Request: { mode: 'mimic'|'explain', contactPhone: string, message: string }
 * Response: { response: string, provider: 'groq'|'gemini', tokensUsed: number }
 */
export async function generateResponse(c: Context) {
  return handle(c, async () => {
    const userId = extractUserIdFromContext(c);
    if (!userId) {
      throw new ProviderError("Unauthorized: No user session", 401);
    }

    const body = await c.req.json();
    const { mode, contactPhone, message } = body;

    // Validate input
    if (!mode || !["mimic", "explain"].includes(mode)) {
      throw new ProviderError("Invalid or missing mode. Must be 'mimic' or 'explain'", 400);
    }
    if (!contactPhone || typeof contactPhone !== "string") {
      throw new ProviderError("Invalid or missing contactPhone", 400);
    }
    if (!message || typeof message !== "string") {
      throw new ProviderError("Invalid or missing message", 400);
    }

    try {
      const result = await aiResponseService.generateResponse(
        userId,
        contactPhone,
        message,
        mode as "mimic" | "explain"
      );
      return result;
    } catch (error) {
      if (error instanceof ProviderError) {
        throw error;
      }
      if (error instanceof Error && error.message.includes("Rate limit")) {
        throw new ProviderError("Rate limit exceeded", 429);
      }
      logger.error("Failed to generate response", {
        error: String(error),
        userId,
        contactPhone,
        mode,
      });
      throw new ProviderError("Failed to generate response", 500);
    }
  });
}

/**
 * GET /api/ai/settings
 * Get current AI settings for user
 * Response: { aiEnabled: boolean, primaryProvider: string, fallbackProvider?: string }
 */
export async function getSettings(c: Context) {
  return handle(c, async () => {
    const userId = extractUserIdFromContext(c);
    if (!userId) {
      throw new ProviderError("Unauthorized: No user session", 401);
    }

    try {
      const result = await db
        .select()
        .from(aiSettings)
        .where(eq(aiSettings.userId, userId))
        .limit(1);

      if (result.length === 0) {
        // Return defaults if no settings exist
        return {
          aiEnabled: true,
          primaryProvider: "groq",
          fallbackProvider: "gemini",
        };
      }

      const settings = result[0];
      return {
        aiEnabled: settings.aiEnabled,
        primaryProvider: settings.primaryProvider,
        fallbackProvider: settings.fallbackProvider,
      };
    } catch (error) {
      logger.error("Failed to get settings", { error: String(error), userId });
      throw new ProviderError("Failed to retrieve settings", 500);
    }
  });
}

/**
 * POST /api/ai/settings
 * Update AI settings for user
 * Request: { aiEnabled?: boolean, primaryProvider?: 'groq'|'gemini', fallbackProvider?: 'groq'|'gemini' }
 * Response: { success: boolean, settings: {...} }
 */
export async function updateSettings(c: Context) {
  return handle(c, async () => {
    const userId = extractUserIdFromContext(c);
    if (!userId) {
      throw new ProviderError("Unauthorized: No user session", 401);
    }

    const body = await c.req.json();
    const { aiEnabled, primaryProvider, fallbackProvider } = body;

    // Validate input
    if (aiEnabled !== undefined && typeof aiEnabled !== "boolean") {
      throw new ProviderError("Invalid aiEnabled: must be boolean", 400);
    }

    const validProviders = ["groq", "gemini"];
    if (primaryProvider && !validProviders.includes(primaryProvider)) {
      throw new ProviderError(
        "Invalid primaryProvider: must be 'groq' or 'gemini'",
        400
      );
    }
    if (fallbackProvider && !validProviders.includes(fallbackProvider)) {
      throw new ProviderError(
        "Invalid fallbackProvider: must be 'groq' or 'gemini'",
        400
      );
    }

    try {
      const now = new Date();
      const existing = await db
        .select()
        .from(aiSettings)
        .where(eq(aiSettings.userId, userId))
        .limit(1);

      let updated;
      if (existing.length === 0) {
        // Create new settings
        await db.insert(aiSettings).values({
          id: crypto.randomUUID(),
          userId,
          aiEnabled: aiEnabled ?? true,
          primaryProvider: (primaryProvider ?? "groq") as "groq" | "gemini",
          fallbackProvider: (fallbackProvider ?? "gemini") as "groq" | "gemini",
          createdAt: now,
          updatedAt: now,
        });
        updated = {
          aiEnabled: aiEnabled ?? true,
          primaryProvider: primaryProvider ?? "groq",
          fallbackProvider: fallbackProvider ?? "gemini",
        };
      } else {
        // Update existing settings
        const updateData: Record<string, any> = { updatedAt: now };
        if (aiEnabled !== undefined) updateData.aiEnabled = aiEnabled;
        if (primaryProvider) updateData.primaryProvider = primaryProvider;
        if (fallbackProvider) updateData.fallbackProvider = fallbackProvider;

        await db.update(aiSettings).set(updateData).where(eq(aiSettings.userId, userId)).run();

        // Fetch updated record
        const result = await db
          .select()
          .from(aiSettings)
          .where(eq(aiSettings.userId, userId))
          .limit(1);

        const settings = result[0];
        updated = settings
          ? {
              aiEnabled: settings.aiEnabled,
              primaryProvider: settings.primaryProvider,
              fallbackProvider: settings.fallbackProvider ?? undefined,
            }
          : {
              aiEnabled: true,
              primaryProvider: "groq",
              fallbackProvider: "gemini",
            };
      }

      return {
        success: true,
        settings: updated,
      };
    } catch (error) {
      logger.error("Failed to update settings", { error: String(error), userId });
      throw new ProviderError("Failed to update settings", 500);
    }
  });
}

/**
 * GET /api/ai/persona/:contactPhone
 * Get persona for a contact
 * Response: { persona: {...}, lastUpdated: Date } | { error: 'not_found' }
 */
export async function getPersona(c: Context) {
  return handle(c, async () => {
    const userId = extractUserIdFromContext(c);
    if (!userId) {
      throw new ProviderError("Unauthorized: No user session", 401);
    }

    const contactPhone = c.req.param("contactPhone");
    if (!contactPhone) {
      throw new ProviderError("Missing contactPhone parameter", 400);
    }

    try {
      const persona = await aiPersonaService.getPersona(userId, contactPhone);

      if (!persona) {
        return c.json(
          { error: "not_found", message: "Persona not found for this contact" },
          404
        );
      }

      return {
        persona,
        lastUpdated: new Date(),
      };
    } catch (error) {
      logger.error("Failed to get persona", {
        error: String(error),
        userId,
        contactPhone,
      });
      throw new ProviderError("Failed to retrieve persona", 500);
    }
  });
}

/**
 * POST /api/ai/persona/:contactPhone/refresh
 * Refresh/extract persona for a contact
 * Response: { persona: {...}, refreshedAt: Date }
 */
export async function refreshPersona(c: Context) {
  return handle(c, async () => {
    const userId = extractUserIdFromContext(c);
    if (!userId) {
      throw new ProviderError("Unauthorized: No user session", 401);
    }

    const contactPhone = c.req.param("contactPhone");
    if (!contactPhone) {
      throw new ProviderError("Missing contactPhone parameter", 400);
    }

    try {
      const persona = await aiPersonaService.refreshPersona(userId, contactPhone);

      return {
        persona,
        refreshedAt: new Date(),
      };
    } catch (error) {
      logger.error("Failed to refresh persona", {
        error: String(error),
        userId,
        contactPhone,
      });
      throw new ProviderError("Failed to refresh persona", 500);
    }
  });
}

/**
 * GET /api/ai/history/:contactPhone
 * Get message history for a contact
 * Query params: limit=50 (optional, max 500)
 * Response: { messages: Array<{message, sender, timestamp}> }
 */
export async function getHistory(c: Context) {
  return handle(c, async () => {
    const userId = extractUserIdFromContext(c);
    if (!userId) {
      throw new ProviderError("Unauthorized: No user session", 401);
    }

    const contactPhone = c.req.param("contactPhone");
    if (!contactPhone) {
      throw new ProviderError("Missing contactPhone parameter", 400);
    }

    const limitStr = c.req.query("limit");
    let limit = 50;

    if (limitStr) {
      const parsed = parseInt(limitStr, 10);
      if (isNaN(parsed) || parsed < 1) {
        throw new ProviderError("Invalid limit: must be a positive integer", 400);
      }
      limit = Math.min(parsed, 500); // Cap at 500
    }

    try {
      const messages = await aiAssistantService.getMessageHistory(
        userId,
        contactPhone,
        limit
      );

      return {
        messages: messages.map((msg) => ({
          message: msg.message,
          sender: msg.sender,
          timestamp: msg.timestamp,
        })),
      };
    } catch (error) {
      logger.error("Failed to get history", {
        error: String(error),
        userId,
        contactPhone,
      });
      throw new ProviderError("Failed to retrieve message history", 500);
    }
  });
}

/**
 * GET /api/ai/usage
 * Get API usage statistics for current user
 * Response: { groq: {calls, resetAt}, gemini: {calls, resetAt} }
 */
export async function getUsage(c: Context) {
  return handle(c, async () => {
    const userId = extractUserIdFromContext(c);
    if (!userId) {
      throw new ProviderError("Unauthorized: No user session", 401);
    }

    try {
      const stats = await apiUsageService.getUsageStats(userId);
      return stats;
    } catch (error) {
      logger.error("Failed to get usage stats", { error: String(error), userId });
      throw new ProviderError("Failed to retrieve usage statistics", 500);
    }
  });
}
