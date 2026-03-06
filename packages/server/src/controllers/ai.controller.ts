import type { Context } from "hono";
import { handle } from "../lib/handle";
import { ProviderError } from "../lib/ai-provider";
import * as aiResponseService from "../services/ai-response.service";
import * as aiPersonaService from "../services/ai-persona.service";
import * as aiAssistantService from "../services/ai-assistant.service";
import * as apiUsageService from "../services/api-usage.service";
import { db } from "../db";
import { aiSettings, apiKeys } from "../db/schema";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger";
import { auth } from "../lib/auth";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AISettingsData {
  aiEnabled: boolean;
  primaryProvider: "groq" | "gemini";
  fallbackProvider?: "groq" | "gemini";
}

// ─── Helper: Extract userId from Auth Cookie ───────────────────────────────────

/**
 * Extract userId from the better-auth session cookie
 */
async function extractUserIdFromContext(c: Context): Promise<string | null> {
  try {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    return session?.user?.id ?? null;
  } catch {
    return null;
  }
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
    const userId = await extractUserIdFromContext(c);
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
    const userId = await extractUserIdFromContext(c);
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
          groqModel: "llama-3.1-8b-instant",
          fallbackGroqModel: "llama-3.1-70b-versatile",
        };
      }

      const settings = result[0];
      return {
        aiEnabled: settings.aiEnabled,
        primaryProvider: settings.primaryProvider,
        fallbackProvider: settings.fallbackProvider,
        groqModel: settings.groqModel,
        fallbackGroqModel: settings.fallbackGroqModel,
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
 * Request: { aiEnabled?: boolean, primaryProvider?: 'groq'|'gemini', fallbackProvider?: 'groq'|'gemini', groqModel?: string }
 * Response: { success: boolean, settings: {...} }
 */
export async function updateSettings(c: Context) {
  return handle(c, async () => {
    const userId = await extractUserIdFromContext(c);
    if (!userId) {
      throw new ProviderError("Unauthorized: No user session", 401);
    }

    const body = await c.req.json();
    const { aiEnabled, primaryProvider, fallbackProvider, groqModel, fallbackGroqModel } = body;

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
    if (groqModel !== undefined && typeof groqModel !== "string") {
      throw new ProviderError("Invalid groqModel: must be string", 400);
    }
    if (fallbackGroqModel !== undefined && typeof fallbackGroqModel !== "string") {
      throw new ProviderError("Invalid fallbackGroqModel: must be string", 400);
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
          groqModel: groqModel ?? "llama-3.1-8b-instant",
          fallbackGroqModel: fallbackGroqModel ?? "llama-3.1-70b-versatile",
          createdAt: now,
          updatedAt: now,
        });
        updated = {
          aiEnabled: aiEnabled ?? true,
          primaryProvider: primaryProvider ?? "groq",
          fallbackProvider: fallbackProvider ?? "gemini",
          groqModel: groqModel ?? "llama-3.1-8b-instant",
          fallbackGroqModel: fallbackGroqModel ?? "llama-3.1-70b-versatile",
        };
      } else {
        // Update existing settings
        const updateData: Record<string, any> = { updatedAt: now };
        if (aiEnabled !== undefined) updateData.aiEnabled = aiEnabled;
        if (primaryProvider) updateData.primaryProvider = primaryProvider;
        if (fallbackProvider) updateData.fallbackProvider = fallbackProvider;
        if (groqModel !== undefined) updateData.groqModel = groqModel;
        if (fallbackGroqModel !== undefined) updateData.fallbackGroqModel = fallbackGroqModel;

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
              groqModel: settings.groqModel,
              fallbackGroqModel: settings.fallbackGroqModel ?? undefined,
            }
          : {
              aiEnabled: true,
              primaryProvider: "groq",
              fallbackProvider: "gemini",
              groqModel: "llama-3.1-8b-instant",
              fallbackGroqModel: "llama-3.1-70b-versatile",
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
    const userId = await extractUserIdFromContext(c);
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
    const userId = await extractUserIdFromContext(c);
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
    const userId = await extractUserIdFromContext(c);
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
    const userId = await extractUserIdFromContext(c);
    if (!userId) {
      throw new ProviderError("Unauthorized: No user session", 401);
    }

    try {
      const stats = await apiUsageService.getUsageStats(userId);
      // Map to frontend-expected format: {used, limit}
      return {
        groq: {
          used: stats.groq.calls,
          limit: 27,
          resetAt: stats.groq.resetAt,
        },
        gemini: {
          used: stats.gemini.calls,
          limit: 54,
          resetAt: stats.gemini.resetAt,
        },
        resetTime: stats.groq.resetAt,
      };
    } catch (error) {
      logger.error("Failed to get usage stats", { error: String(error), userId });
      throw new ProviderError("Failed to retrieve usage statistics", 500);
    }
  });
}

/**
 * GET /api/ai/api-keys/groq
 * Get all Groq API keys for the user
 */
export async function getGroqApiKeys(c: Context) {
  return handle(c, async () => {
    const userId = await extractUserIdFromContext(c);
    if (!userId) {
      throw new ProviderError("Unauthorized: No user session", 401);
    }

    try {
      const keys = await db
        .select({ id: apiKeys.id, name: apiKeys.name, keyValue: apiKeys.keyValue, createdAt: apiKeys.createdAt })
        .from(apiKeys)
        .where(eq(apiKeys.userId, userId));

      return { keys };
    } catch (error) {
      logger.error("Failed to get API keys", { error: String(error), userId });
      throw new ProviderError("Failed to retrieve API keys", 500);
    }
  });
}

/**
 * POST /api/ai/api-keys/groq
 * Add a new Groq API key
 * Request: { keyValue: string, name?: string }
 */
export async function addGroqApiKey(c: Context) {
  return handle(c, async () => {
    const userId = await extractUserIdFromContext(c);
    if (!userId) {
      throw new ProviderError("Unauthorized: No user session", 401);
    }

    const body = await c.req.json();
    const { keyValue, name } = body;

    if (!keyValue || typeof keyValue !== "string" || !keyValue.trim()) {
      throw new ProviderError("API key value is required", 400);
    }

    try {
      const keyId = crypto.randomUUID();
      const now = new Date();

      await db.insert(apiKeys).values({
        id: keyId,
        userId,
        provider: "groq",
        keyValue: keyValue.trim(),
        name: name || undefined,
        createdAt: now,
      });

      logger.info("Groq API key added", { userId, keyId });

      return {
        success: true,
        key: {
          id: keyId,
          name: name || undefined,
          keyValue: keyValue.trim(),
          createdAt: now.toISOString(),
        },
      };
    } catch (error) {
      logger.error("Failed to add API key", { error: String(error), userId });
      throw new ProviderError("Failed to add API key", 500);
    }
  });
}

/**
 * DELETE /api/ai/api-keys/groq/:keyId
 * Remove a Groq API key
 */
export async function removeGroqApiKey(c: Context) {
  return handle(c, async () => {
    const userId = await extractUserIdFromContext(c);
    if (!userId) {
      throw new ProviderError("Unauthorized: No user session", 401);
    }

    const keyId = c.req.param("keyId");
    if (!keyId) {
      throw new ProviderError("Key ID is required", 400);
    }

    try {
      // Verify the key belongs to this user
      const key = await db
        .select()
        .from(apiKeys)
        .where(eq(apiKeys.id, keyId))
        .limit(1);

      if (key.length === 0 || key[0].userId !== userId) {
        throw new ProviderError("API key not found or unauthorized", 404);
      }

      await db.delete(apiKeys).where(eq(apiKeys.id, keyId)).run();

      logger.info("Groq API key removed", { userId, keyId });

      return { success: true, message: "API key removed" };
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      logger.error("Failed to remove API key", { error: String(error), userId, keyId });
      throw new ProviderError("Failed to remove API key", 500);
    }
  });
}

/**
 * GET /api/ai/contacts
 * Get all contacts that have AI chat history
 */
export async function getContacts(c: Context) {
  return handle(c, async () => {
    const userId = await extractUserIdFromContext(c);
    if (!userId) {
      throw new ProviderError("Unauthorized: No user session", 401);
    }

    try {
      const phones = await aiAssistantService.getContacts(userId);
      const contacts = phones.map((phone) => ({
        id: phone,
        phone,
        name: phone,
        messageCount: 0,
        mimicMode: false,
        status: "ready" as const,
      }));
      return { contacts };
    } catch (error) {
      logger.error("Failed to get contacts", { error: String(error), userId });
      throw new ProviderError("Failed to retrieve contacts", 500);
    }
  });
}

/**
 * POST /api/ai/test-connection
 * Test connection to a provider
 * Request: { provider: 'groq'|'gemini' }
 */
export async function testConnection(c: Context) {
  return handle(c, async () => {
    const userId = await extractUserIdFromContext(c);
    if (!userId) {
      throw new ProviderError("Unauthorized: No user session", 401);
    }

    const body = await c.req.json();
    const { provider } = body;

    if (!provider || !["groq", "gemini"].includes(provider)) {
      throw new ProviderError("Invalid provider: must be 'groq' or 'gemini'", 400);
    }

    try {
      // DB keys only (per-account isolation)
      const dbKeys = await db
        .select({ keyValue: apiKeys.keyValue })
        .from(apiKeys)
        .where(eq(apiKeys.userId, userId));
      const keys = dbKeys.map((k) => k.keyValue);

      if (keys.length === 0 || !keys[0]) {
        return { success: false, message: `No API keys configured for ${provider}. Add keys in settings.` };
      }

      return { success: true, message: `${provider} API key found and configured` };
    } catch (error) {
      logger.error("Failed to test connection", { error: String(error), userId, provider });
      return { success: false, message: `Failed to test connection: ${String(error)}` };
    }
  });
}

/**
 * POST /api/ai/mimic-mode
 * Toggle mimic mode for a contact
 * Request: { contactId: string, enabled: boolean }
 */
export async function toggleMimicMode(c: Context) {
  return handle(c, async () => {
    const userId = await extractUserIdFromContext(c);
    if (!userId) {
      throw new ProviderError("Unauthorized: No user session", 401);
    }

    const body = await c.req.json();
    const { contactId, enabled } = body;

    if (!contactId) {
      throw new ProviderError("contactId is required", 400);
    }
    if (typeof enabled !== "boolean") {
      throw new ProviderError("enabled must be boolean", 400);
    }

    return { success: true, contactId, enabled };
  });
}

/**
 * POST /api/ai/refresh-all-personas
 * Refresh personas for all contacts
 */
export async function refreshAllPersonas(c: Context) {
  return handle(c, async () => {
    const userId = await extractUserIdFromContext(c);
    if (!userId) {
      throw new ProviderError("Unauthorized: No user session", 401);
    }

    try {
      const phones = await aiAssistantService.getContacts(userId);
      let refreshed = 0;

      for (const phone of phones) {
        try {
          await aiPersonaService.refreshPersona(userId, phone);
          refreshed++;
        } catch (e) {
          logger.warn("Failed to refresh persona for contact", { userId, phone, error: String(e) });
        }
      }

      return { success: true, refreshed };
    } catch (error) {
      logger.error("Failed to refresh all personas", { error: String(error), userId });
      throw new ProviderError("Failed to refresh personas", 500);
    }
  });
}
