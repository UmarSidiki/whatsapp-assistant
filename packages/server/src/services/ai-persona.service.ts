import { eq, and, desc } from "drizzle-orm";
import { db } from "../db";
import { aiPersona, aiChatHistory } from "../db/schema";
import { getMessageHistory } from "./ai-assistant.service";
import { logger } from "../lib/logger";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Persona {
  tone: string; // 'formal', 'casual', 'humorous', 'professional', 'friendly'
  emojiUsage: {
    frequency: "low" | "medium" | "high";
    topEmojis: string[]; // top 5 most used emojis
  };
  messageFormat: {
    avgLength: number; // average message character count
    preferredStructure: "short" | "medium" | "long"; // based on avgLength
    usesPunctuation: boolean;
    usesCapitalization: boolean;
  };
  commonPhrases: string[]; // top 5 phrases the person uses
  greetingStyle: string; // 'formal', 'casual', 'friendly', 'none'
  responsePatterns: string; // description of how they respond
}

// ─── Default Persona ──────────────────────────────────────────────────────────

const DEFAULT_PERSONA: Persona = {
  tone: "casual",
  emojiUsage: {
    frequency: "low",
    topEmojis: [],
  },
  messageFormat: {
    avgLength: 50,
    preferredStructure: "short",
    usesPunctuation: false,
    usesCapitalization: false,
  },
  commonPhrases: [],
  greetingStyle: "none",
  responsePatterns: "Neutral communication style",
};

// ─── Emoji Detection ──────────────────────────────────────────────────────────

/**
 * Extract all emojis from text using Unicode ranges
 */
function extractEmojis(text: string): string[] {
  // Emoji ranges: most common emoji blocks
  const emojiPattern =
    /[\uD83C-\uDBFF][\uDC00-\uDFFF]|[\u2600-\u27BF]|[\u2300-\u23FF]|[\u2000-\u206F]|[\u20D0-\u20FF]|[\uFE00-\uFE0F]/g;
  const matches = text.match(emojiPattern);
  return matches || [];
}

/**
 * Count frequency of items in an array
 */
function countFrequency<T>(items: T[]): Map<T, number> {
  const freq = new Map<T, number>();
  for (const item of items) {
    freq.set(item, (freq.get(item) || 0) + 1);
  }
  return freq;
}

/**
 * Get top N items by frequency
 */
function getTopN<T>(freq: Map<T, number>, n: number): T[] {
  return Array.from(freq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([item]) => item);
}

// ─── Tone Detection ───────────────────────────────────────────────────────────

/**
 * Detect tone from message patterns
 */
function detectTone(messages: string[]): string {
  if (messages.length === 0) return "casual";

  let exclamationCount = 0;
  let questionCount = 0;
  let capitalLetters = 0;
  let totalLetters = 0;
  let formalWordCount = 0;
  let casualWordCount = 0;

  const formalWords = /\b(please|kindly|regards|sincerely|moreover|furthermore|however)\b/gi;
  const casualWords = /\b(hey|yeah|lol|gonna|wanna|awesome|cool|nice|dude|bro)\b/gi;

  for (const msg of messages) {
    exclamationCount += (msg.match(/!/g) || []).length;
    questionCount += (msg.match(/\?/g) || []).length;

    const formalMatches = msg.match(formalWords) || [];
    const casualMatches = msg.match(casualWords) || [];

    formalWordCount += formalMatches.length;
    casualWordCount += casualMatches.length;

    for (const char of msg) {
      if (/[a-zA-Z]/.test(char)) {
        totalLetters++;
        if (/[A-Z]/.test(char)) capitalLetters++;
      }
    }
  }

  const capitalizationRatio = totalLetters > 0 ? capitalLetters / totalLetters : 0;
  const exclamationRatio = messages.length > 0 ? exclamationCount / messages.length : 0;

  // Decision tree for tone
  if (formalWordCount > 0 && capitalizationRatio < 0.3) {
    return "formal";
  }

  if (exclamationRatio > 0.3 && capitalizationRatio > 0.2) {
    return "humorous";
  }

  if (casualWordCount > formalWordCount && exclamationRatio > 0.2) {
    return "friendly";
  }

  if (capitalizationRatio < 0.15 && exclamationRatio < 0.1 && questionCount === 0) {
    return "professional";
  }

  return "casual";
}

// ─── Message Format Analysis ──────────────────────────────────────────────────

/**
 * Analyze message format patterns
 */
function analyzeMessageFormat(messages: string[]): Persona["messageFormat"] {
  if (messages.length === 0) {
    return {
      avgLength: 0,
      preferredStructure: "short",
      usesPunctuation: false,
      usesCapitalization: false,
    };
  }

  const lengths = messages.map((m) => m.length);
  const avgLength = lengths.reduce((a, b) => a + b, 0) / messages.length;

  let punctuationCount = 0;
  let capitalizationCount = 0;

  for (const msg of messages) {
    if (/[.!?;:]/.test(msg)) punctuationCount++;
    const capitalLetters = (msg.match(/[A-Z]/g) || []).length;
    if (capitalLetters > 0) capitalizationCount++;
  }

  const usesPunctuation = punctuationCount / messages.length > 0.3;
  const usesCapitalization = capitalizationCount / messages.length > 0.3;

  let preferredStructure: "short" | "medium" | "long" = "medium";
  if (avgLength < 50) preferredStructure = "short";
  else if (avgLength > 150) preferredStructure = "long";

  return {
    avgLength: Math.round(avgLength),
    preferredStructure,
    usesPunctuation,
    usesCapitalization,
  };
}

// ─── Phrase Extraction ────────────────────────────────────────────────────────

/**
 * Extract common phrases (2-3 word combinations)
 */
function extractCommonPhrases(messages: string[]): string[] {
  const phraseCounts = new Map<string, number>();

  for (const msg of messages) {
    // Split into words and clean
    const words = msg
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 2);

    // Extract 2-word phrases
    for (let i = 0; i < words.length - 1; i++) {
      const phrase = `${words[i]} ${words[i + 1]}`;
      if (phrase.length > 4) {
        phraseCounts.set(phrase, (phraseCounts.get(phrase) || 0) + 1);
      }
    }

    // Extract 3-word phrases
    for (let i = 0; i < words.length - 2; i++) {
      const phrase = `${words[i]} ${words[i + 1]} ${words[i + 2]}`;
      if (phrase.length > 8) {
        phraseCounts.set(phrase, (phraseCounts.get(phrase) || 0) + 1);
      }
    }
  }

  // Only keep phrases that appear 2+ times
  const frequentPhrases = Array.from(phraseCounts.entries())
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([phrase]) => phrase);

  return frequentPhrases;
}

// ─── Greeting Style ───────────────────────────────────────────────────────────

/**
 * Detect greeting style from first words of messages
 */
function detectGreetingStyle(messages: string[]): string {
  if (messages.length === 0) return "none";

  const greetingCounts = {
    formal: 0,
    casual: 0,
    friendly: 0,
    none: 0,
  };

  const formalGreetings = /^(hello|hi there|good morning|good afternoon|dear)/i;
  const casualGreetings = /^(hey|yo|sup|what's up|wassup)/i;
  const friendlyGreetings = /^(hey\s+\w+|hi\s+\w+|hello\s+\w+|hey\s+there)/i;

  for (const msg of messages) {
    const trimmed = msg.trim();
    if (friendlyGreetings.test(trimmed)) {
      greetingCounts.friendly++;
    } else if (formalGreetings.test(trimmed)) {
      greetingCounts.formal++;
    } else if (casualGreetings.test(trimmed)) {
      greetingCounts.casual++;
    } else {
      greetingCounts.none++;
    }
  }

  // Return the most common greeting style
  let maxCount = 0;
  let mostCommon: string = "none";

  for (const [style, count] of Object.entries(greetingCounts)) {
    if (count > maxCount) {
      maxCount = count;
      mostCommon = style;
    }
  }

  return mostCommon !== "none" && maxCount > messages.length * 0.1
    ? mostCommon
    : "none";
}

// ─── Response Patterns ─────────────────────────────────────────────────────────

/**
 * Analyze response patterns
 */
function analyzeResponsePatterns(messages: string[]): string {
  if (messages.length === 0) return "Neutral communication style";

  let questionCount = 0;
  let exclamationCount = 0;
  let averageLength = 0;

  for (const msg of messages) {
    if (msg.includes("?")) questionCount++;
    if (msg.includes("!")) exclamationCount++;
    averageLength += msg.length;
  }

  averageLength /= messages.length;

  const patterns: string[] = [];

  if (questionCount / messages.length > 0.3) {
    patterns.push("frequently asks questions");
  }

  if (exclamationCount / messages.length > 0.3) {
    patterns.push("uses many exclamations");
  }

  if (averageLength > 150) {
    patterns.push("tends to write longer messages");
  } else if (averageLength < 50) {
    patterns.push("prefers brief messages");
  }

  if (patterns.length === 0) {
    return "Neutral communication style";
  }

  return patterns.join(", ") + ".";
}

// ─── Main Functions ───────────────────────────────────────────────────────────

/**
 * Extract persona from message history
 */
export async function extractPersona(
  userId: string,
  contactPhone: string,
  limit: number = 100
): Promise<Persona> {
  try {
    logger.info("Extracting persona", { userId, contactPhone, limit });

    // Get message history for the contact
    const history = await getMessageHistory(userId, contactPhone, limit);

    if (history.length === 0) {
      logger.warn("No message history found for persona extraction", {
        userId,
        contactPhone,
      });
      return DEFAULT_PERSONA;
    }

    // Filter to only messages from the contact
    const contactMessages = history
      .filter((h) => h.sender === "contact")
      .map((h) => h.message);

    if (contactMessages.length === 0) {
      logger.warn("No contact messages found in history", {
        userId,
        contactPhone,
      });
      return DEFAULT_PERSONA;
    }

    // Extract emojis
    const allEmojis: string[] = [];
    for (const msg of contactMessages) {
      allEmojis.push(...extractEmojis(msg));
    }

    const emojiFreq = countFrequency(allEmojis);
    const topEmojis = getTopN(emojiFreq, 5);
    const totalMessages = contactMessages.length;
    const emojiFrequency: "low" | "medium" | "high" =
      allEmojis.length > totalMessages * 0.5
        ? "high"
        : allEmojis.length > totalMessages * 0.1
          ? "medium"
          : "low";

    // Detect tone
    const tone = detectTone(contactMessages);

    // Analyze message format
    const messageFormat = analyzeMessageFormat(contactMessages);

    // Extract common phrases
    const commonPhrases = extractCommonPhrases(contactMessages);

    // Detect greeting style
    const greetingStyle = detectGreetingStyle(contactMessages);

    // Analyze response patterns
    const responsePatterns = analyzeResponsePatterns(contactMessages);

    const persona: Persona = {
      tone,
      emojiUsage: {
        frequency: emojiFrequency,
        topEmojis,
      },
      messageFormat,
      commonPhrases,
      greetingStyle,
      responsePatterns,
    };

    logger.debug("Persona extracted successfully", { userId, contactPhone, persona });

    return persona;
  } catch (e) {
    logger.error("Error extracting persona", {
      error: String(e),
      userId,
      contactPhone,
    });
    return DEFAULT_PERSONA;
  }
}

/**
 * Save extracted persona to database
 */
export async function savePersona(
  userId: string,
  contactPhone: string,
  persona: Persona
): Promise<void> {
  try {
    const normalizedPhone = contactPhone.replace(/\D/g, "");
    if (!normalizedPhone) {
      logger.warn("AI persona: Invalid phone number", { contactPhone });
      return;
    }

    const personaId = crypto.randomUUID();
    const now = new Date();

    // Check if persona already exists
    const existing = await db
      .select()
      .from(aiPersona)
      .where(
        and(
          eq(aiPersona.userId, userId),
          eq(aiPersona.contactPhone, normalizedPhone)
        )
      )
      .limit(1);

    if (existing.length > 0) {
      // Update existing
      await db
        .update(aiPersona)
        .set({
          persona: JSON.stringify(persona),
          lastUpdated: now,
        })
        .where(
          and(
            eq(aiPersona.userId, userId),
            eq(aiPersona.contactPhone, normalizedPhone)
          )
        );

      logger.debug("Persona updated", { userId, contactPhone: normalizedPhone });
    } else {
      // Insert new
      await db.insert(aiPersona).values({
        id: personaId,
        userId,
        contactPhone: normalizedPhone,
        persona: JSON.stringify(persona),
        lastUpdated: now,
      });

      logger.debug("Persona saved", { userId, contactPhone: normalizedPhone });
    }
  } catch (e) {
    logger.error("Error saving persona", {
      error: String(e),
      userId,
      contactPhone,
    });
  }
}

/**
 * Get cached persona for a contact
 */
export async function getPersona(
  userId: string,
  contactPhone: string
): Promise<Persona | null> {
  try {
    const normalizedPhone = contactPhone.replace(/\D/g, "");

    const result = await db
      .select()
      .from(aiPersona)
      .where(
        and(
          eq(aiPersona.userId, userId),
          eq(aiPersona.contactPhone, normalizedPhone)
        )
      )
      .limit(1);

    if (result.length === 0) {
      return null;
    }

    const cached = result[0];

    // Check if persona is older than 24 hours
    const now = new Date();
    const dayInMs = 24 * 60 * 60 * 1000;
    if (now.getTime() - cached.lastUpdated.getTime() > dayInMs) {
      logger.debug("Persona cache expired", { userId, contactPhone: normalizedPhone });
      return null;
    }

    const persona = JSON.parse(cached.persona) as Persona;
    logger.debug("Persona retrieved from cache", { userId, contactPhone: normalizedPhone });

    return persona;
  } catch (e) {
    logger.error("Error retrieving persona", {
      error: String(e),
      userId,
      contactPhone,
    });
    return null;
  }
}

/**
 * Refresh persona for a contact (extract + save)
 */
export async function refreshPersona(
  userId: string,
  contactPhone: string
): Promise<Persona> {
  try {
    logger.info("Refreshing persona", { userId, contactPhone });

    const persona = await extractPersona(userId, contactPhone);
    await savePersona(userId, contactPhone, persona);

    logger.info("Persona refreshed", { userId, contactPhone });

    return persona;
  } catch (e) {
    logger.error("Error refreshing persona", {
      error: String(e),
      userId,
      contactPhone,
    });
    return DEFAULT_PERSONA;
  }
}

/**
 * Generate system prompt for AI using persona
 */
export function generatePersonaPrompt(persona: Persona): string {
  const parts: string[] = [];

  parts.push(`You are mimicking the messaging style of a contact with the following characteristics:`);
  parts.push("");
  parts.push(`**Tone**: ${persona.tone}`);

  if (persona.emojiUsage.frequency !== "low" && persona.emojiUsage.topEmojis.length > 0) {
    parts.push(
      `**Emoji Usage**: ${persona.emojiUsage.frequency} frequency. Commonly used emojis: ${persona.emojiUsage.topEmojis.join(", ")}`
    );
  }

  parts.push(
    `**Message Format**: Typically ${persona.messageFormat.preferredStructure} messages (avg ${persona.messageFormat.avgLength} characters)`
  );

  if (persona.messageFormat.usesPunctuation) {
    parts.push(`- Uses punctuation marks regularly`);
  }

  if (persona.messageFormat.usesCapitalization) {
    parts.push(`- Uses capitalization for emphasis`);
  }

  if (persona.commonPhrases.length > 0) {
    parts.push(`**Common Phrases**: ${persona.commonPhrases.join(", ")}`);
  }

  if (persona.greetingStyle !== "none") {
    parts.push(`**Greeting Style**: ${persona.greetingStyle}`);
  }

  parts.push(`**Communication Pattern**: ${persona.responsePatterns}`);
  parts.push("");
  parts.push(`Use these patterns to match their style naturally in your responses.`);

  return parts.join("\n");
}
