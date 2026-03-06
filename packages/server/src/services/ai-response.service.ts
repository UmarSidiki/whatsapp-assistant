import { createProvider } from "../lib/ai-provider";
import { getMessageHistory } from "./ai-assistant.service";
import { getPersona, extractPersona, generatePersonaPrompt } from "./ai-persona.service";
import { isProviderAvailable, getBestAvailableProvider, trackApiCall } from "./api-usage.service";
import { logger } from "../lib/logger";
import { db } from "../db";
import { aiSettings, apiKeys } from "../db/schema";
import { eq, and } from "drizzle-orm";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AIResponseResult {
  response: string;
  provider: "groq" | "gemini";
  tokensUsed: number;
}

// ─── Main Functions ───────────────────────────────────────────────────────────

/**
 * Generate AI response with automatic provider fallback
 * Supports two modes: mimic (natural messaging) and explain (AI analysis)
 */
export async function generateResponse(
  userId: string,
  contactPhone: string,
  message: string,
  mode: "mimic" | "explain",
  conversationHistory?: Array<{ role: "user" | "assistant"; content: string }>
): Promise<AIResponseResult> {
  if (!userId || !contactPhone || !message.trim()) {
    throw new Error("userId, contactPhone, and message are required");
  }

  try {
    logger.info("Generating AI response", { userId, contactPhone, mode });

    // Get conversation context if not provided
    let history = conversationHistory;
    if (!history) {
      const contextMessages = await getConversationContext(userId, contactPhone, 50);
      history = contextMessages;
    }

    // Generate response based on mode
    let response: string;
    let provider: "groq" | "gemini";

    if (mode === "mimic") {
      const result = await generateMimicResponse(
        userId,
        contactPhone,
        message,
        history
      );
      response = result.response;
      provider = result.provider;
    } else {
      const result = await generateExplainResponse(
        userId,
        contactPhone,
        message,
        history
      );
      response = result.response;
      provider = result.provider;
    }

    // Estimate tokens (roughly 1 token per 4 characters)
    const tokensUsed = Math.ceil(response.length / 4);

    logger.info("AI response generated successfully", {
      userId,
      contactPhone,
      mode,
      provider,
      tokensUsed,
    });

    return {
      response,
      provider,
      tokensUsed,
    };
  } catch (error) {
    logger.error("Failed to generate AI response", {
      error: String(error),
      userId,
      contactPhone,
      mode,
    });
    throw error;
  }
}

/**
 * Get conversation context (last N messages for context)
 */
export async function getConversationContext(
  userId: string,
  contactPhone: string,
  limit: number = 50
): Promise<Array<{ role: "user" | "assistant"; content: string }>> {
  try {
    const messages = await getMessageHistory(userId, contactPhone, limit);

    const context: Array<{ role: "user" | "assistant"; content: string }> = [];

    for (const msg of messages) {
      context.push({
        role: msg.sender === "contact" ? "user" : "assistant",
        content: msg.message,
      });
    }

    return context;
  } catch (error) {
    logger.warn("Failed to get conversation context", {
      error: String(error),
      userId,
      contactPhone,
    });
    return [];
  }
}

/**
 * Split long responses into multiple messages (mimic mode only)
 * Returns array of messages to send sequentially
 */
export function splitIntoMultipleMessages(response: string): string[] {
  if (!response.trim()) {
    return [];
  }

  // If response is short enough, return as single message
  if (response.length <= 300) {
    return [response];
  }

  const messages: string[] = [];

  // Try to split on double newlines first (natural message breaks)
  const doubleNewlineParts = response.split("\n\n");
  if (doubleNewlineParts.length > 1) {
    // Recombine small parts with adjacent parts to avoid tiny messages
    for (const part of doubleNewlineParts) {
      const trimmed = part.trim();
      if (!trimmed) continue;

      // Check if this part should be combined with the last message
      if (messages.length > 0 && messages[messages.length - 1].length + trimmed.length < 300) {
        messages[messages.length - 1] += "\n\n" + trimmed;
      } else {
        messages.push(trimmed);
      }
    }

    // If we got reasonable messages, return them
    if (messages.length > 0) {
      return messages;
    }
  }

  // If no double newlines, try to split on sentence boundaries
  // Look for period + space + capital letter
  const sentencePattern = /\.[\s]+(?=[A-Z])/g;
  let lastIndex = 0;
  let currentMessage = "";

  // Find all sentence boundaries
  const boundaries: number[] = [];
  let match;
  while ((match = sentencePattern.exec(response)) !== null) {
    boundaries.push(match.index + 1); // After the period
  }

  // If no boundaries found, return whole response
  if (boundaries.length === 0) {
    return [response];
  }

  // Build messages from boundaries
  for (const boundary of boundaries) {
    const candidateMessage = response.substring(lastIndex, boundary).trim();

    // If adding this sentence would exceed max length, save current and start new
    if (currentMessage.length + candidateMessage.length > 300) {
      if (currentMessage) {
        messages.push(currentMessage);
        currentMessage = candidateMessage;
      } else {
        // Sentence itself is too long, but include it anyway
        messages.push(candidateMessage);
      }
    } else {
      if (currentMessage) {
        currentMessage += " " + candidateMessage;
      } else {
        currentMessage = candidateMessage;
      }
    }

    lastIndex = boundary;
  }

  // Add remaining text
  const remaining = response.substring(lastIndex).trim();
  if (remaining) {
    if (currentMessage) {
      if (currentMessage.length + remaining.length < 300) {
        currentMessage += " " + remaining;
      } else {
        messages.push(currentMessage);
        messages.push(remaining);
      }
    } else {
      messages.push(remaining);
    }
  } else if (currentMessage) {
    messages.push(currentMessage);
  }

  return messages.length > 0 ? messages : [response];
}

// ─── Private Functions ────────────────────────────────────────────────────────

/**
 * Generate response in mimic mode (mimic contact's messaging style)
 */
async function generateMimicResponse(
  userId: string,
  contactPhone: string,
  message: string,
  history: Array<{ role: "user" | "assistant"; content: string }>
): Promise<{ response: string; provider: "groq" | "gemini" }> {
  try {
    // Get persona from cache or extract fresh
    let persona = await getPersona(userId, contactPhone);
    if (!persona) {
      logger.debug("Persona not cached, extracting fresh", { userId, contactPhone });
      persona = await extractPersona(userId, contactPhone);
    }

    // Generate system prompt using persona
    const systemPrompt = generatePersonaPrompt(persona);

    // Build conversation history for context
    const historyText = history
      .map((h) => {
        const sender = h.role === "user" ? "Contact" : "You";
        return `${sender}: ${h.content}`;
      })
      .join("\n");

    // Build full prompt
    const fullPrompt = `${systemPrompt}

Conversation History:
${historyText}

Latest message to respond to: "${message}"

Generate your response as if you are this contact, mimicking their messaging style. Keep it natural and conversational.`;

    // Select provider
    const { provider, isPrimary } = await selectProvider(userId);
    logger.debug("Selected provider for mimic mode", { userId, provider, isPrimary });

    // Generate response
    const response = await callAIProvider(userId, provider, fullPrompt, isPrimary);

    // Track API call
    const model = provider === "groq" ? (isPrimary ? "llama-3.1-8b-instant" : "llama-3.1-70b-versatile") : "gemini-1.5-flash";
    await trackApiCall(userId, provider, model);

    return { response, provider };
  } catch (error) {
    logger.error("Failed to generate mimic response", {
      error: String(error),
      userId,
      contactPhone,
    });
    throw error;
  }
}

/**
 * Generate response in explain mode (AI analysis)
 */
async function generateExplainResponse(
  userId: string,
  contactPhone: string,
  message: string,
  history: Array<{ role: "user" | "assistant"; content: string }>
): Promise<{ response: string; provider: "groq" | "gemini" }> {
  try {
    // Simple system prompt for explain mode
    const systemPrompt = "You are a helpful AI assistant. Provide clear, concise analysis and responses.";

    // Build context from history
    const contextMessages = history
      .slice(-5) // Last 5 messages for context
      .map((h) => {
        const sender = h.role === "user" ? "Contact" : "Assistant";
        return `${sender}: ${h.content}`;
      })
      .join("\n");

    // Build full prompt
    const fullPrompt = `${systemPrompt}

Help me understand or respond to this message. Be clear and concise.

${contextMessages ? `Context:\n${contextMessages}\n` : ""}

Message: "${message}"

Your analysis/response:`;

    // Select provider
    const { provider, isPrimary } = await selectProvider(userId);
    logger.debug("Selected provider for explain mode", { userId, provider, isPrimary });

    // Generate response
    const response = await callAIProvider(userId, provider, fullPrompt, isPrimary);

    // Track API call
    const model = provider === "groq" ? (isPrimary ? "llama-3.1-8b-instant" : "llama-3.1-70b-versatile") : "gemini-1.5-flash";
    await trackApiCall(userId, provider, model);

    return { response, provider };
  } catch (error) {
    logger.error("Failed to generate explain response", {
      error: String(error),
      userId,
      contactPhone,
    });
    throw error;
  }
}

/**
 * Select best available provider using user's configured primary/fallback
 */
async function selectProvider(userId: string): Promise<{ provider: "groq" | "gemini"; isPrimary: boolean }> {
  try {
    // Get user's provider settings
    const settingsResult = await db
      .select({ primaryProvider: aiSettings.primaryProvider, fallbackProvider: aiSettings.fallbackProvider })
      .from(aiSettings)
      .where(eq(aiSettings.userId, userId))
      .limit(1);

    const primaryProvider = settingsResult[0]?.primaryProvider ?? "groq";
    const fallbackProvider = settingsResult[0]?.fallbackProvider ?? "gemini";

    // Try primary provider
    const primaryAvailable = await isProviderAvailable(userId, primaryProvider);
    if (primaryAvailable) {
      return { provider: primaryProvider, isPrimary: true };
    }

    // Try fallback
    const fallbackAvailable = await isProviderAvailable(userId, fallbackProvider);
    if (fallbackAvailable) {
      logger.info("Primary provider unavailable, switching to fallback", { userId, primaryProvider, fallbackProvider });
      return { provider: fallbackProvider, isPrimary: false };
    }

    // Both unavailable
    logger.error("All providers unavailable", { userId });
    throw new Error("All AI providers are unavailable due to rate limits");
  } catch (error) {
    logger.error("Provider selection failed", { error: String(error), userId });
    throw error;
  }
}

/**
 * Call AI provider to generate response
 * API keys come from the database only (per-account isolation)
 */
async function callAIProvider(userId: string, provider: "groq" | "gemini", prompt: string, isPrimary: boolean = true): Promise<string> {
  try {
    // Get user's DB-stored API keys only (no env var fallback for per-account isolation)
    const dbKeys = await db
      .select({ keyValue: apiKeys.keyValue })
      .from(apiKeys)
      .where(and(eq(apiKeys.userId, userId), eq(apiKeys.provider, provider)));

    const allKeys = dbKeys.map((k) => k.keyValue).filter(Boolean);

    if (allKeys.length === 0) {
      throw new Error(`No API keys configured for ${provider}. Add keys in AI Assistant settings.`);
    }

    // Get user settings to retrieve the model
    let model: string | undefined;
    if (provider === "groq") {
      try {
        const userSettings = await db
          .select({ groqModel: aiSettings.groqModel, fallbackGroqModel: aiSettings.fallbackGroqModel })
          .from(aiSettings)
          .where(eq(aiSettings.userId, userId))
          .limit(1);

        model = !isPrimary && userSettings[0]?.fallbackGroqModel
          ? userSettings[0].fallbackGroqModel
          : (userSettings[0]?.groqModel || "llama-3.1-8b-instant");
      } catch (error) {
        logger.warn("Failed to fetch groqModel from settings, using default", { userId, error: String(error) });
        model = "llama-3.1-8b-instant";
      }
    }

    const aiProvider = createProvider(provider, allKeys, model);
    const response = await aiProvider.generateResponse(prompt);

    logger.debug("AI provider call successful", { provider, model });
    return response;
  } catch (error) {
    logger.error("AI provider call failed", { error: String(error), provider });
    throw error;
  }
}
