import { eq, and } from "drizzle-orm";
import { db } from "../db";
import { aiSettings, aiPersona } from "../db/schema";
import { logger } from "../lib/logger";
import { normalizeContactId } from "./wa-socket";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CommandResult {
  type:
    | "explain"
    | "mimic"
    | "global_mimic"
    | "refresh"
    | "status"
    | "download_media"
    | "spam"
    | null;
  content?: string; // for !me, the text to explain
  requiresResponse?: boolean;
  data?: any;
}

// ─── State ────────────────────────────────────────────────────────────────────

/**
 * Store per-contact mimic settings: Map<userId_contactPhone, isEnabled>
 * Note: This persists for the session. For persistent storage, use a DB table.
 */
const mimicSettings = new Map<string, boolean>();

function getMimicKey(userId: string, contactPhone: string): string {
  return `${userId}_${contactPhone}`;
}

/**
 * Returns true if mimic mode is active for this contact.
 * Default (not in map) → active (opt-out model).
 * Only returns false if explicitly disabled via !mimic off.
 */
export function isMimicEnabledForContact(userId: string, contactPhone: string): boolean {
  const key = getMimicKey(userId, contactPhone);
  // If never set, default to enabled (opt-out: AI responds to everyone unless disabled)
  if (!mimicSettings.has(key)) return true;
  return mimicSettings.get(key) ?? true;
}

export function setMimicEnabledForContact(
  userId: string,
  contactPhone: string,
  enabled: boolean
): void {
  mimicSettings.set(getMimicKey(userId, contactPhone), enabled);
}

/** Clear cached per-contact mimic overrides for a user (disconnect/unlink cleanup). */
export function clearMimicSettingsForUser(userId: string): void {
  const prefix = `${userId}_`;
  const keysToDelete: string[] = [];
  mimicSettings.forEach((_, key) => {
    if (key.startsWith(prefix)) {
      keysToDelete.push(key);
    }
  });
  keysToDelete.forEach((key) => mimicSettings.delete(key));
}

// ─── Command Parsing ──────────────────────────────────────────────────────────

/**
 * Parse message for special commands
 * Supports:
 * - !me <message>          → Explain/answer mode
 * - !me -r - task -time    → Standardized reminder syntax (relative/AM-PM)
 * - !me -s 10 -d 5 - hi    → Repeat message in chat
 * - !mimic on/off          → Toggle persona mimicry
 * - !refresh persona       → Force update persona
 * - !ai status             → Show AI settings
 */
export function parseCommand(message: string): CommandResult {
  const trimmed = message.trim();

  // !me -d -here - download view-once media and send it in the same chat
  const downloadHereMatch = trimmed.match(/^!me\s+-d\s+-here$/i);
  if (downloadHereMatch) {
    return {
      type: "download_media",
      data: { target: "here" },
      requiresResponse: true,
    };
  }

  // !me -d -n {number} - download view-once media and send to specified number
  const downloadNumberMatch = trimmed.match(/^!me\s+-d\s+-n\s+(\S+)$/i);
  if (downloadNumberMatch) {
    return {
      type: "download_media",
      data: { target: "number", number: downloadNumberMatch[1] },
      requiresResponse: true,
    };
  }

  // !me -s {count} -d {seconds} - {message}
  const spamPrefixMatch = trimmed.match(/^!me\s+-s\s+(\d+)\s+-d\s+(\d+)\s*-\s+(.+)$/i);
  if (spamPrefixMatch) {
    return {
      type: "spam",
      data: {
        count: Number(spamPrefixMatch[1]),
        delaySeconds: Number(spamPrefixMatch[2]),
        message: spamPrefixMatch[3]?.trim(),
      },
      requiresResponse: true,
    };
  }

  // !me {message} -s {count} -d {seconds}
  const spamSuffixMatch = trimmed.match(/^!me\s+(.+?)\s+-s\s+(\d+)\s+-d\s+(\d+)$/i);
  if (spamSuffixMatch) {
    return {
      type: "spam",
      data: {
        message: spamSuffixMatch[1]?.trim(),
        count: Number(spamSuffixMatch[2]),
        delaySeconds: Number(spamSuffixMatch[3]),
      },
      requiresResponse: true,
    };
  }

  // !me -s {count} -d {seconds} (message can come from replied text)
  const spamWithoutMessageMatch = trimmed.match(/^!me\s+-s\s+(\d+)\s+-d\s+(\d+)$/i);
  if (spamWithoutMessageMatch) {
    return {
      type: "spam",
      data: {
        count: Number(spamWithoutMessageMatch[1]),
        delaySeconds: Number(spamWithoutMessageMatch[2]),
      },
      requiresResponse: true,
    };
  }

  // !me <message> - explain/answer mode
  // FIX: Changed regex to allow !me without requiring content (handles edge case)
  // But still requires content for actual processing
  const meMatch = trimmed.match(/^!me(?:\s+(.+))?$/i);
  if (meMatch) {
    const content = meMatch[1]?.trim() || "";
    // Only return explain type if there's actual content
    if (content) {
      return {
        type: "explain",
        content: content,
        requiresResponse: true,
      };
    }
    // If empty !me, treat as unknown command - will be restored to original text
  }

  // !mimic global on|off - toggle AI globally (before per-contact check)
  const mimicGlobalMatch = trimmed.match(/^!mimic\s+global\s+(on|off)$/i);
  if (mimicGlobalMatch) {
    return {
      type: "global_mimic",
      data: { enabled: mimicGlobalMatch[1].toLowerCase() === "on" },
      requiresResponse: true,
    };
  }

  // !mimic on|off - toggle mimic mode
  const mimicMatch = trimmed.match(/^!mimic\s+(on|off)$/i);
  if (mimicMatch) {
    return {
      type: "mimic",
      data: { enabled: mimicMatch[1].toLowerCase() === "on" },
      requiresResponse: true,
    };
  }

  // !refresh persona - force persona update
  const refreshMatch = trimmed.match(/^!refresh\s+persona$/i);
  if (refreshMatch) {
    return {
      type: "refresh",
      requiresResponse: true,
    };
  }

  // !ai status - show AI settings
  const statusMatch = trimmed.match(/^!ai\s+status$/i);
  if (statusMatch) {
    return {
      type: "status",
      requiresResponse: true,
    };
  }

  return { type: null };
}

// ─── Command Execution ────────────────────────────────────────────────────────

/**
 * Execute a command and return response
 */
export async function executeCommand(
  userId: string,
  contactPhone: string,
  command: CommandResult
): Promise<string> {
  if (!command.type) {
    return "";
  }

  try {
    switch (command.type) {
      case "explain":
        // For explain mode, the response generation would be handled elsewhere
        // This function returns a confirmation that the command was parsed
        return `📝 Explain mode activated for: "${command.content}"`;

      case "mimic":
        const enabled = command.data?.enabled ?? false;
        setMimicEnabledForContact(userId, contactPhone, enabled);
        return enabled
          ? "🎭 Mimic mode enabled for this contact"
          : "🎭 Mimic mode disabled for this contact";

      case "global_mimic":
        const globalEnabled = command.data?.enabled ?? false;
        try {
          await db
            .update(aiSettings)
            .set({ aiEnabled: globalEnabled, updatedAt: new Date() })
            .where(eq(aiSettings.userId, userId));
          return globalEnabled
            ? "✅ AI assistant globally enabled — responding to all contacts"
            : "🔴 AI assistant globally disabled — not responding to anyone";
        } catch {
          return "❌ Failed to update global AI setting";
        }

      case "refresh":
        // Call refreshPersona logic
        return await refreshPersona(userId, contactPhone);

      case "status":
        return await getAIStatusMessage(userId);

      case "spam":
        return "✅ Spam command parsed";

      default:
        return "Unknown command";
    }
  } catch (error) {
    logger.error("Error executing command", {
      error: String(error),
      userId,
      contactPhone,
      commandType: command.type,
    });
    return "❌ Error executing command";
  }
}

/**
 * Refresh persona for a contact
 */
async function refreshPersona(userId: string, contactPhone: string): Promise<string> {
  try {
    const normalizedPhone = normalizeContactId(contactPhone);
    if (!normalizedPhone) {
      return "❌ Invalid contact for persona refresh";
    }

    // Delete existing persona to force refresh
    await db
      .delete(aiPersona)
      .where(
        and(
          eq(aiPersona.userId, userId),
          eq(aiPersona.contactPhone, normalizedPhone)
        )
      );

    logger.info("Persona refreshed for contact", {
      userId,
      contactPhone: normalizedPhone,
    });

    return "🔄 Persona refreshed! Will update on next message.";
  } catch (error) {
    logger.error("Failed to refresh persona", {
      error: String(error),
      userId,
      contactPhone,
    });
    return "❌ Failed to refresh persona";
  }
}

/**
 * Get AI status message for current user
 */
async function getAIStatusMessage(userId: string): Promise<string> {
  try {
    const settings = await db
      .select({
        aiEnabled: aiSettings.aiEnabled,
        primaryProvider: aiSettings.primaryProvider,
        fallbackProvider: aiSettings.fallbackProvider,
        botName: aiSettings.botName,
      })
      .from(aiSettings)
      .where(eq(aiSettings.userId, userId))
      .then((rows) => rows[0]);

    if (!settings) {
      return [
        "⚙️ AI Assistant Status",
        "",
        "• Status: Not configured",
        "• Primary provider: Not set",
        "",
        "⚠️ Configure AI settings in the dashboard first.",
      ].join("\n");
    }

    const status = settings.aiEnabled ? "✅ Enabled" : "❌ Disabled";
    const provider = settings.primaryProvider || "groq";
    const fallback = settings.fallbackProvider ? `${settings.fallbackProvider}` : "None";
    const botAlias = settings.botName?.trim() || "";
    const botCmd = botAlias
      ? `• !${botAlias} <text> — public AI assistant command for contacts`
      : null;
    const reminderCommand = botAlias
      ? `!me -r - {task} -{time} (or !${botAlias} -r - {task} -{time})`
      : "!me -r - {task} -{time}";
    const downloadHereCommand = botAlias
      ? `!me -d -here (or !${botAlias} -d -here)`
      : "!me -d -here";
    const downloadNumberCommand = botAlias
      ? `!me -d -n {number} (or !${botAlias} -d -n {number})`
      : "!me -d -n {number}";
    const spamCommand = botAlias
      ? `!me -s {count} -d {seconds} - {message} (or !${botAlias} -s {count} -d {seconds} - {message})`
      : "!me -s {count} -d {seconds} - {message}";

    return [
      "⚙️ AI Assistant Status",
      "",
      `• Status: ${status}`,
      `• Primary provider: ${provider}`,
      `• Fallback provider: ${fallback}`,
      "",
      "📌 Commands",
      "• !me <text> — private AI analysis/response",
      "• !me -r - {task} -{time} — schedule reminder (e.g. -30 minutes or -4:00 AM)",
      ...(botCmd ? [botCmd] : []),
      "• !me -d -here — save view-once media to this chat",
      "• !me -d -n {number} — save view-once media to a number",
      "• !me -s {count} -d {seconds} - {message} — repeat message with delay",
      "• !mimic on/off — toggle auto-reply for this contact",
      "• !mimic global on/off — toggle AI for all contacts",
      "• !refresh persona — rebuild persona from chat history",
      "• !ai status — show this status",
      "",
      "📘 Setup guide",
      `• Reminder format: ${reminderCommand}`,
      "  Example: !me -r - pay electricity bill -30 minutes",
      "  Example: !me -r - join standup -4:00 AM",
      "• Once-view download:",
      "  1) Reply to a once-view media message",
      `  2) Use ${downloadHereCommand} to copy it in this chat`,
      `  3) Use ${downloadNumberCommand} to send it to another number`,
      `• Repeat message format: ${spamCommand}`,
      "  Example: !me -s 10 -d 5 - payment reminder",
      "  Tip: reply to a text and use !me -s 10 -d 5 to repeat replied text",
    ].join("\n");
  } catch (error) {
    logger.error("Failed to get AI settings", {
      error: String(error),
      userId,
    });
    return "⚙️ AI Settings: Unable to retrieve";
  }
}

// ─── Response Decision ────────────────────────────────────────────────────────

/**
 * Determine if a message should trigger AI response
 * Handles both !me explicit mode and auto-mimic mode
 */
export async function shouldGenerateAIResponse(
  userId: string,
  contactPhone: string,
  message: string,
  aiEnabled: boolean
): Promise<{
  shouldRespond: boolean;
  mode: "explain" | "mimic" | null;
  command?: CommandResult;
}> {
  // Parse for commands first
  const command = parseCommand(message);

  // If it's an !me command, always respond in explain mode
  if (command.type === "explain") {
    return {
      shouldRespond: true,
      mode: "explain",
      command,
    };
  }

  // If AI is disabled globally, don't respond
  if (!aiEnabled) {
    return {
      shouldRespond: false,
      mode: null,
      command: command.type ? command : undefined,
    };
  }

  // When AI is enabled globally, respond to ALL contacts by default.
  // Per-contact mimic toggle is now opt-OUT: only skip if explicitly disabled.
  const mimicKey = getMimicKey(userId, contactPhone);
  const explicitlyDisabled = mimicSettings.has(mimicKey) && mimicSettings.get(mimicKey) === false;

  return {
    shouldRespond: !explicitlyDisabled,
    mode: !explicitlyDisabled ? "mimic" : null,
    command: command.type ? command : undefined,
  };
}

// ─── Utilities ────────────────────────────────────────────────────────────────

/**
 * Check if a message is a command (starts with !)
 */
export function isCommand(message: string): boolean {
  return /^!/i.test(message.trim());
}

/**
 * Get all active mimic contacts for a user
 */
export function getActiveMimicContacts(userId: string): string[] {
  const prefix = `${userId}_`;
  const contacts: string[] = [];

  mimicSettings.forEach((enabled, key) => {
    if (key.startsWith(prefix) && enabled) {
      contacts.push(key.slice(prefix.length));
    }
  });

  return contacts;
}
