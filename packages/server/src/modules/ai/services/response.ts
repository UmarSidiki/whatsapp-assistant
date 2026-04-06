import { createProvider } from "../../../core/utils";
import { getMessageHistory } from "./assistant";
import {
  getPersona,
  extractPersona,
  generatePersonaPrompt,
} from "./persona";
import {
  isProviderAvailable,
  getBestAvailableProvider,
  trackApiCall,
} from "./api-usage";
import { logger } from "../../../core/logger";
import { db } from "../../../database";
import { aiSettings, apiKeys } from "../../../database";
import { eq, and } from "drizzle-orm";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AIResponseResult {
  response: string;
  segments: string[];
  provider: "groq" | "gemini";
  tokensUsed: number;
}

// ─── Main Functions ───────────────────────────────────────────────────────────

/**
 * Generate AI response with automatic provider fallback
 * Supports three modes: mimic (natural messaging), explain (AI analysis), and bot (AI assistant)
 */
export async function generateResponse(
  userId: string,
  contactPhone: string,
  message: string,
  mode: "mimic" | "explain" | "bot",
  conversationHistory?: Array<{ role: "user" | "assistant"; content: string }>,
): Promise<AIResponseResult> {
  if (!userId || !contactPhone || !message.trim()) {
    throw new Error("userId, contactPhone, and message are required");
  }

  try {
    logger.info("Generating AI response", { userId, contactPhone, mode });

    // Get conversation context if not provided
    let history = conversationHistory;
    if (!history) {
      const contextMessages = await getConversationContext(
        userId,
        contactPhone,
        50,
      );
      history = contextMessages;
    }

    // Generate response based on mode
    let response: string;
    let segments: string[] = [];
    let provider: "groq" | "gemini";

    if (mode === "mimic") {
      const result = await generateMimicResponse(
        userId,
        contactPhone,
        message,
        history,
      );
      response = result.response;
      segments = result.segments;
      provider = result.provider;
    } else if (mode === "explain") {
      const result = await generateExplainResponse(
        userId,
        contactPhone,
        message,
        history,
      );
      response = result.response;
      provider = result.provider;
    } else {
      const result = await generateBotResponse(
        userId,
        contactPhone,
        message,
        history,
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
      segments,
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
 * Get conversation context (last N messages for context).
 * Consecutive messages from the same sender are merged into one to avoid choppy context.
 */
export async function getConversationContext(
  userId: string,
  contactPhone: string,
  limit: number = 50,
): Promise<Array<{ role: "user" | "assistant"; content: string }>> {
  try {
    const messages = await getMessageHistory(userId, contactPhone, limit);

    const context: Array<{ role: "user" | "assistant"; content: string }> = [];

    for (const msg of messages) {
      const role: "user" | "assistant" =
        msg.sender === "contact" ? "user" : "assistant";
      // Merge consecutive messages from the same sender into one entry
      const last = context.length > 0 ? context[context.length - 1] : undefined;
      if (last && last.role === role) {
        last.content += "\n" + msg.message;
      } else {
        context.push({ role, content: msg.message });
      }
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
      if (
        messages.length > 0 &&
        messages[messages.length - 1].length + trimmed.length < 300
      ) {
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

function extractResponseFromJsonPayload(raw: string): string | null {
  const candidates: string[] = [raw];
  const objectBlockMatch = raw.match(/\{[\s\S]*\}/);
  if (objectBlockMatch?.[0]) {
    candidates.push(objectBlockMatch[0]);
  }

  const responseKeys = [
    "response",
    "reply",
    "finalResponse",
    "final_response",
    "answer",
    "output",
  ];

  for (const candidate of candidates) {
    try {
      const parsed: unknown = JSON.parse(candidate);
      if (!parsed || typeof parsed !== "object") {
        continue;
      }
      const record = parsed as Record<string, unknown>;
      for (const key of responseKeys) {
        const value = record[key];
        if (typeof value === "string" && value.trim()) {
          return value.trim();
        }
      }
    } catch {
      continue;
    }
  }

  return null;
}

function extractResponseFromLabeledText(raw: string): string | null {
  const quotedMatch = raw.match(
    /(?:roman\s*urdu\s*)?(?:final\s*)?(?:response|reply|answer)[^"'`\u201c\u201d]*["'\u201c]([^"\u201d]+)["'\u201d]/i,
  );
  if (quotedMatch?.[1]?.trim()) {
    return quotedMatch[1].trim();
  }

  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    const labelMatch = line.match(
      /^(?:roman\s*urdu\s*)?(?:final\s*)?(?:response|reply|answer)\s*[:\-]\s*(.+)$/i,
    );
    if (labelMatch?.[1]?.trim()) {
      return labelMatch[1].trim().replace(/^["'\u201c]+|["'\u201d]+$/g, "").trim();
    }
  }

  return null;
}

function normalizeExplainOutput(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    return raw;
  }

  const fromJson = extractResponseFromJsonPayload(trimmed);
  if (fromJson) {
    return fromJson;
  }

  const fromLabel = extractResponseFromLabeledText(trimmed);
  if (fromLabel) {
    return fromLabel;
  }

  const looksLikeStructuredAnalysis = /(analysis|user\s+ne\s+kaha|ai\s+ko\s+chahiye|roman\s*urdu\s*response)/i.test(trimmed);
  if (!looksLikeStructuredAnalysis) {
    return trimmed;
  }

  const quotedSnippets = Array.from(trimmed.matchAll(/["\u201c]([^"\u201d\n]{3,})["\u201d]/g))
    .map((match) => (match[1] ?? "").trim())
    .filter(Boolean);
  if (quotedSnippets.length > 0) {
    return quotedSnippets[quotedSnippets.length - 1];
  }

  const lines = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^(analysis|user\s+ne\s+kaha|ai\s+ko\s+chahiye)\b/i.test(line));
  if (lines.length > 0) {
    return lines[lines.length - 1];
  }

  return trimmed;
}

// ─── Private Functions ────────────────────────────────────────────────────────

/**
 * Generate response in mimic mode (reply as the user, matching their style)
 */
async function generateMimicResponse(
  userId: string,
  contactPhone: string,
  message: string,
  history: Array<{ role: "user" | "assistant"; content: string }>,
): Promise<{
  response: string;
  segments: string[];
  provider: "groq" | "gemini";
}> {
  try {
    // Get persona from cache or extract fresh
    let persona = await getPersona(userId, contactPhone);
    if (!persona) {
      logger.debug("Persona not cached, extracting fresh", {
        userId,
        contactPhone,
      });
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

    // Select provider (also fetches customInstructions)
    const { provider, isPrimary, customInstructions } =
      await selectProvider(userId);
    logger.debug("Selected provider for mimic mode", {
      userId,
      provider,
      isPrimary,
    });

    // Append custom instructions to the prompt if configured
    const customNote = customInstructions
      ? `\n\nAdditional instruction from the user: ${customInstructions}`
      : "";

    // Build full prompt — ask for JSON output when using Groq
    const fullPrompt = `${systemPrompt}${customNote}

Conversation History:
${historyText}

Latest message from contact: "${message}"

Reply as this person would naturally reply to this contact. Be genuine, emotional, and human.

You MUST respond in valid JSON format:
{
  "response": "your full reply text here",
  "emotion": "the emotion behind this reply (e.g. happy, caring, playful, neutral, concerned)",
  "segments": ["segment 1", "segment 2"]
}

The "segments" array should split your response into natural message chunks like a human would send on WhatsApp (e.g. separate thoughts, follow-ups).
If the reply is long, break it into 2-3 shorter messages.
If the reply is short (under 100 chars), just use one segment.
Example: ["Hey!", "I'm doing good, thanks for asking.", "How about you?"]
Do NOT include any text outside the JSON object.`;

    // Generate response — ask for JSON via prompt; don't enforce API-level JSON mode
    // as many Groq models (guard, speech, newer) don't support response_format: json_object
    const raw = await callAIProvider(
      userId,
      provider,
      fullPrompt,
      isPrimary,
      false,
    );

    // Try to parse JSON response, fall back to raw text
    let response: string;
    let segments: string[] = [];
    try {
      const parsed = JSON.parse(raw);
      // Prefer AI-provided segments array — send each as a separate message
      if (
        parsed.segments &&
        Array.isArray(parsed.segments) &&
        parsed.segments.length > 0
      ) {
        segments = (parsed.segments as unknown[])
          .map((s) => String(s).trim())
          .filter(Boolean);
        response = segments.join("\n");
      } else {
        response = parsed.response || raw;
      }
    } catch {
      // Not JSON — use raw response (happens with Gemini or non-JSON-mode models)
      response = raw;
    }

    return { response, segments, provider };
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
  history: Array<{ role: "user" | "assistant"; content: string }>,
): Promise<{ response: string; provider: "groq" | "gemini" }> {
  try {
    // Keep explain mode output directly usable and do not enforce custom AI persona instructions.
    const systemPrompt =
      "You are a helpful AI assistant directly answering the user's explicit query. " +
      "Provide a clear, direct, and concise answer without conversational filler or preambles like 'Here is the answer'.";

    // Build context from history
    const contextMessages = history
      .slice(-5) // Last 5 messages for context
      .map((h) => {
        const sender = h.role === "user" ? "Contact" : "Assistant";
        return `${sender}: ${h.content}`;
      })
      .join("\n");

    // Select provider
    const { provider, isPrimary } = await selectProvider(userId);
    logger.debug("Selected provider for explain mode", {
      userId,
      provider,
      isPrimary,
    });

    // We INTENTIONALLY omit user's generic customInstructions here, as !me is for direct ad-hoc answers.

    // Build full prompt
    const fullPrompt = `${systemPrompt}

${contextMessages ? `Recent Chat Context (for reference):\n${contextMessages}\n` : ""}

User's Query: "${message}"

Return only the final response text:`;

    // Generate response — NO JSON mode for explain (plain text response)
    const response = await callAIProvider(
      userId,
      provider,
      fullPrompt,
      isPrimary,
      false,
    );

    const normalizedResponse = normalizeExplainOutput(response);
    return { response: normalizedResponse || response.trim(), provider };
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
 * Generate response in bot mode (Direct AI Assistant for the contact)
 */
async function generateBotResponse(
  userId: string,
  contactPhone: string,
  message: string,
  history: Array<{ role: "user" | "assistant"; content: string }>,
): Promise<{ response: string; provider: "groq" | "gemini" }> {
  try {
    // Select provider to get botName and customInstructions
    const { provider, isPrimary, customInstructions, botName } =
      await selectProvider(userId);

    const botIdentity = botName
      ? `You are an AI assistant answering to the name "${botName}". `
      : "You are a helpful AI assistant representing the user. ";
    const systemPrompt = `${botIdentity}A contact on WhatsApp is talking to you directly. Please answer their query helpfully and concisely.`;

    // Build context from history
    const contextMessages = history
      .slice(-5) // Last 5 messages
      .map((h) => {
        const sender = h.role === "user" ? "Contact" : "You (Assistant)";
        return `${sender}: ${h.content}`;
      })
      .join("\n");

    const customNote = customInstructions
      ? `\n\nAdditional instruction: ${customInstructions}`
      : "";

    // Build full prompt
    const fullPrompt = `${systemPrompt}${customNote}

${contextMessages ? `Recent Conversation Context:\n${contextMessages}\n` : ""}

Contact's Message: "${message}"

Your helpful response (keep it brief and natural for WhatsApp):`;

    const response = await callAIProvider(
      userId,
      provider,
      fullPrompt,
      isPrimary,
      false,
    );

    return { response, provider };
  } catch (error) {
    logger.error("Failed to generate bot response", {
      error: String(error),
      userId,
      contactPhone,
    });
    throw error;
  }
}

/**
 * Select best available provider using user's configured primary/fallback.
 * Also returns customInstructions and botName from settings.
 */
async function selectProvider(userId: string): Promise<{
  provider: "groq" | "gemini";
  isPrimary: boolean;
  customInstructions: string | null;
  botName: string | null;
}> {
  try {
    // Get user's provider settings
    const settingsResult = await db
      .select({
        primaryProvider: aiSettings.primaryProvider,
        fallbackProvider: aiSettings.fallbackProvider,
        customInstructions: aiSettings.customInstructions,
        botName: aiSettings.botName,
      })
      .from(aiSettings)
      .where(eq(aiSettings.userId, userId))
      .limit(1);

    const primaryProvider = settingsResult[0]?.primaryProvider ?? "groq";
    const fallbackProvider = settingsResult[0]?.fallbackProvider ?? "gemini";
    const customInstructions = settingsResult[0]?.customInstructions ?? null;
    const botName = settingsResult[0]?.botName ?? null;

    // Try primary provider
    const primaryAvailable = await isProviderAvailable(userId, primaryProvider);
    if (primaryAvailable) {
      return {
        provider: primaryProvider,
        isPrimary: true,
        customInstructions,
        botName,
      };
    }

    // Try fallback
    const fallbackAvailable = await isProviderAvailable(
      userId,
      fallbackProvider,
    );
    if (fallbackAvailable) {
      logger.info("Primary provider unavailable, switching to fallback", {
        userId,
        primaryProvider,
        fallbackProvider,
      });
      return {
        provider: fallbackProvider,
        isPrimary: false,
        customInstructions,
        botName,
      };
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
export async function callAIProvider(
  userId: string,
  provider: "groq" | "gemini",
  prompt: string,
  isPrimary: boolean = true,
  jsonMode: boolean = false,
): Promise<string> {
  try {
    logger.info("[callAIProvider] Starting", {
      userId,
      provider,
      isPrimary,
      jsonMode,
    });

    // Get user's DB-stored API keys only (per-account isolation)
    const dbKeys = await db
      .select({ keyValue: apiKeys.keyValue })
      .from(apiKeys)
      .where(and(eq(apiKeys.userId, userId), eq(apiKeys.provider, provider)));

    const allKeys = dbKeys.map((k) => k.keyValue).filter(Boolean);

    if (allKeys.length === 0) {
      throw new Error(
        `No API keys configured for ${provider}. Add keys in AI Assistant settings.`,
      );
    }

    logger.info("[callAIProvider] Found API keys", {
      userId,
      provider,
      keyCount: allKeys.length,
    });

    // Get user settings to retrieve the model
    let model: string | undefined;

    try {
      const userSettings = await db
        .select({
          groqModel: aiSettings.groqModel,
          fallbackGroqModel: aiSettings.fallbackGroqModel,
          geminiModel: aiSettings.geminiModel,
        })
        .from(aiSettings)
        .where(eq(aiSettings.userId, userId))
        .limit(1);

      if (provider === "groq") {
        model =
          !isPrimary && userSettings[0]?.fallbackGroqModel
            ? userSettings[0].fallbackGroqModel
            : userSettings[0]?.groqModel || "llama-3.1-8b-instant";
      } else {
        model = userSettings[0]?.geminiModel || "gemini-2.0-flash";
      }
    } catch (error) {
      logger.warn("Failed to fetch model from settings, using default", {
        userId,
        provider,
        error: String(error),
      });
      model = provider === "groq" ? "llama-3.1-8b-instant" : "gemini-2.0-flash";
    }

    logger.info("[callAIProvider] Using model", {
      userId,
      provider,
      model,
      jsonMode,
    });

    const aiProvider = createProvider(provider, allKeys, model, jsonMode);
    const { text, headers } = await aiProvider.generateResponse(prompt);

    logger.info("[callAIProvider] Success", {
      provider,
      model,
      responseLength: text.length,
    });

    // Track API call with the actual model used and raw headers
    await trackApiCall(userId, provider, model!, headers).catch((e) =>
      logger.warn("[callAIProvider] Failed to track API call", {
        userId,
        provider,
        model,
        error: String(e),
      }),
    );

    return text;
  } catch (error) {
    logger.error("[callAIProvider] Failed", { error: String(error), provider });
    throw error;
  }
}

/**
 * Use AI to generate a natural language description of how the user communicates with a contact.
 * This is called once when a persona is first created, then cached.
 * Returns null if the AI call fails (caller should fall back to rule-based persona).
 */
export async function generatePersonaAIDescription(
  userId: string,
  contactPhone: string,
  messageHistory: Array<{ message: string; sender: "me" | "contact" }>,
): Promise<string | null> {
  try {
    const userMessages = messageHistory.filter((m) => m.sender === "me");
    if (userMessages.length < 5) return null;

    // Build a sample of messages for analysis (up to 80 from user + 20 from contact for context)
    const sampleMe = userMessages
      .slice(-80)
      .map((m) => `[Me]: ${m.message}`)
      .join("\n");
    const sampleContact = messageHistory
      .filter((m) => m.sender === "contact")
      .slice(-20)
      .map((m) => `[Contact]: ${m.message}`)
      .join("\n");

    const prompt = `You are analyzing a person's WhatsApp messaging style for a specific contact.

Below are messages exchanged between this person ([Me]) and their contact ([Contact]).

${sampleMe}

${sampleContact}

Analyze ONLY the [Me] messages and write a concise but detailed description (5-8 sentences) of:
1. Their tone and writing style (formal/casual/playful/professional)
2. Their emotional relationship with this contact (loving/caring/friendly/professional)
3. How they use emojis (frequency, which ones they favor)
4. Their typical message length and structure
5. Any signature phrases or words they use repeatedly
6. How they greet and close conversations
7. The overall "voice" that makes their messages feel uniquely theirs

Write in second person ("This person writes...", "They tend to...", "Their messages often...").
Be specific — mention actual patterns you observe, not generic descriptions.
Output ONLY the description, no headers or extra text.`;

    const description = await (async () => {
      const { provider, isPrimary } = await selectProvider(userId);
      return callAIProvider(userId, provider, prompt, isPrimary, false);
    })();
    logger.info("AI persona description generated", {
      userId,
      contactPhone,
      length: description.length,
    });
    return description;
  } catch (error) {
    logger.warn(
      "Failed to generate AI persona description (will use rule-based fallback)",
      {
        userId,
        contactPhone,
        error: String(error),
      },
    );
    return null;
  }
}
