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
  emotionalTone: string; // 'loving', 'caring', 'playful', 'neutral', 'professional', 'warm'
  /** AI-generated natural language description of this person's voice. When present, used instead of rule-based prompt. */
  aiDescription?: string;
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
  emotionalTone: "neutral",
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

// ─── Emotional Tone Detection ─────────────────────────────────────────────────

/**
 * Detect the emotional tone of the user's relationship with a contact
 * by analyzing both the user's and contact's messages
 */
function detectEmotionalTone(userMessages: string[], contactMessages: string[]): string {
  if (userMessages.length === 0) return "neutral";

  const all = userMessages.join(" ").toLowerCase();

  // Score each emotional category
  const scores: Record<string, number> = {
    loving: 0,
    caring: 0,
    playful: 0,
    warm: 0,
    professional: 0,
    neutral: 0,
  };

  // Loving indicators
  const lovingWords = /\b(love|miss you|baby|babe|jaan|jaanu|sweetheart|darling|my love|i love|❤️|💕|💖|💗|😘|😍|🥰|💋)\b/gi;
  scores.loving += (all.match(lovingWords) || []).length * 2;

  // Caring indicators
  const caringWords = /\b(take care|how are you|feeling better|eat|sleep well|be safe|worried|hope you|praying|thinking of you|miss|care about)\b/gi;
  scores.caring += (all.match(caringWords) || []).length * 1.5;

  // Playful indicators
  const playfulWords = /\b(lol|haha|😂|🤣|😜|😝|rofl|lmao|funny|joke|hehe|teasing|😏|🤪|silly)\b/gi;
  scores.playful += (all.match(playfulWords) || []).length * 1.5;

  // Warm/friendly indicators
  const warmWords = /\b(thanks|thank you|appreciate|great|amazing|awesome|wonderful|happy|glad|excited|🙏|😊|🤗|proud)\b/gi;
  scores.warm += (all.match(warmWords) || []).length;

  // Professional indicators
  const professionalWords = /\b(regards|sir|ma'am|please find|attached|meeting|schedule|deadline|deliverable|update|noted|acknowledged)\b/gi;
  scores.professional += (all.match(professionalWords) || []).length * 2;

  // Emoji density boost (high emoji usage suggests emotional warmth)
  const emojiCount = extractEmojis(all).length;
  if (emojiCount > userMessages.length * 0.3) {
    scores.warm += 2;
    scores.loving += 1;
  }

  // Find highest scoring emotion
  let maxScore = 0;
  let dominant = "neutral";
  for (const [emotion, score] of Object.entries(scores)) {
    if (score > maxScore) {
      maxScore = score;
      dominant = emotion;
    }
  }

  return maxScore > 2 ? dominant : "neutral";
}

// ─── Main Functions ───────────────────────────────────────────────────────────

/**
 * Extract persona from message history.
 * Analyzes the USER's own messages to a specific contact
 * to understand how the user communicates with them.
 */
export async function extractPersona(
  userId: string,
  contactPhone: string,
  limit: number = 100
): Promise<Persona> {
  try {
    logger.info("Extracting user persona for contact", { userId, contactPhone, limit });

    const history = await getMessageHistory(userId, contactPhone, limit);

    if (history.length === 0) {
      logger.warn("No message history found for persona extraction", { userId, contactPhone });
      return DEFAULT_PERSONA;
    }

    // Analyze the USER's own messages to this contact (not the contact's messages)
    const userMessages = history
      .filter((h) => h.sender === "me")
      .map((h) => h.message);

    if (userMessages.length < 3) {
      logger.warn("Not enough user messages for persona extraction", { userId, contactPhone, count: userMessages.length });
      return DEFAULT_PERSONA;
    }

    // Also get contact's messages for relationship context
    const contactMessages = history
      .filter((h) => h.sender === "contact")
      .map((h) => h.message);

    // Extract emoji usage from user's messages
    const allEmojis: string[] = [];
    for (const msg of userMessages) {
      allEmojis.push(...extractEmojis(msg));
    }
    const emojiFreq = countFrequency(allEmojis);
    const topEmojis = getTopN(emojiFreq, 5);
    const emojiFrequency: "low" | "medium" | "high" =
      allEmojis.length > userMessages.length * 0.5
        ? "high"
        : allEmojis.length > userMessages.length * 0.1
          ? "medium"
          : "low";

    // Detect user's tone toward this contact
    const tone = detectTone(userMessages);

    // Analyze user's message format
    const messageFormat = analyzeMessageFormat(userMessages);

    // Extract user's common phrases
    const commonPhrases = extractCommonPhrases(userMessages);

    // Detect user's greeting style
    const greetingStyle = detectGreetingStyle(userMessages);

    // Analyze user's response patterns
    const responsePatterns = analyzeResponsePatterns(userMessages);

    // Detect emotional relationship with contact
    const emotionalTone = detectEmotionalTone(userMessages, contactMessages);

    const persona: Persona = {
      tone,
      emojiUsage: { frequency: emojiFrequency, topEmojis },
      messageFormat,
      commonPhrases,
      greetingStyle,
      responsePatterns,
      emotionalTone,
    };

    logger.debug("User persona extracted", { userId, contactPhone, emotionalTone: persona.emotionalTone });
    return persona;
  } catch (e) {
    logger.error("Error extracting persona", { error: String(e), userId, contactPhone });
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
 * Generate system prompt for AI using the user's persona toward a contact.
 * The AI should reply AS the user, matching how they naturally talk to this person.
 * If the persona has an AI-generated description, that is used as the primary voice guide.
 */
export function generatePersonaPrompt(persona: Persona): string {
  const parts: string[] = [];

  parts.push(`You are a WhatsApp AI assistant replying on behalf of a real person. Your job is to write messages exactly the way this person naturally writes to this contact.`);
  parts.push("");

  // AI-generated description takes priority — it's richer than the rule-based breakdown
  if (persona.aiDescription) {
    parts.push(`Here is a detailed analysis of how this person communicates with this contact:`);
    parts.push("");
    parts.push(persona.aiDescription);
  } else {
    parts.push(`Here is how this person communicates with this contact:`);
    parts.push("");
    parts.push(`**Communication Tone**: ${persona.tone}`);
    parts.push(`**Emotional Relationship**: ${persona.emotionalTone}`);

    if (persona.emotionalTone === "loving") {
      parts.push(`- This person is loving and affectionate with this contact. Use warm, intimate language. Include endearments naturally.`);
    } else if (persona.emotionalTone === "caring") {
      parts.push(`- This person is caring and attentive toward this contact. Show concern, ask about wellbeing, be supportive.`);
    } else if (persona.emotionalTone === "playful") {
      parts.push(`- This person is playful and humorous with this contact. Use light jokes, teasing, and fun energy.`);
    } else if (persona.emotionalTone === "warm") {
      parts.push(`- This person is warm and friendly with this contact. Be appreciative, positive, and encouraging.`);
    } else if (persona.emotionalTone === "professional") {
      parts.push(`- This person keeps a professional tone with this contact. Stay formal, concise, and task-oriented.`);
    }

    if (persona.emojiUsage.frequency !== "low" && persona.emojiUsage.topEmojis.length > 0) {
      parts.push(
        `**Emoji Usage**: ${persona.emojiUsage.frequency} frequency. Favorite emojis: ${persona.emojiUsage.topEmojis.join(" ")}`
      );
    } else {
      parts.push(`**Emoji Usage**: Rarely uses emojis`);
    }

    parts.push(
      `**Message Length**: ${persona.messageFormat.preferredStructure} messages (avg ${persona.messageFormat.avgLength} chars)`
    );

    if (persona.commonPhrases.length > 0) {
      parts.push(`**Signature Phrases**: "${persona.commonPhrases.join('", "')}"`);
    }

    if (persona.greetingStyle !== "none") {
      parts.push(`**Greeting Style**: ${persona.greetingStyle}`);
    }

    parts.push(`**Communication Pattern**: ${persona.responsePatterns}`);
  }

  parts.push("");
  parts.push(`IMPORTANT RULES:`);
  parts.push(`- Write EXACTLY like this person — same length, same style, same emotions`);
  parts.push(`- Match their emoji frequency and favorites`);
  parts.push(`- Use their common phrases and greetings naturally`);
  parts.push(`- Be genuinely human — show real emotions, not robotic responses`);
  parts.push(`- Keep the same emotional warmth/distance they maintain with this contact`);
  parts.push(`- Do NOT add disclaimers, headers, or explanations — just the raw message text`);
  parts.push(`- If they write short casual texts, you write short casual texts`);

  return parts.join("\n");
}
