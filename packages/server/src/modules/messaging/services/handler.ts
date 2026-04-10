import { eq, and, desc, max, sql } from "drizzle-orm";
import { db } from "../../../database";
import { aiSettings, aiPersona, waChatMessage } from "../../../database";
import { logger } from "../../../core/logger";
import { normalizeContactId, getContactName } from "../../whatsapp/services";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CommandResult {
  type:
    | "explain"
    | "mimic"
    | "global_mimic"
    | "mimic_status"
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
 * Explicit per-contact settings always win:
 * - true  => enabled for this contact
 * - false => disabled for this contact
 * - unset => falls back to the global default (aiEnabled)
 */
export function isMimicEnabledForContact(
  userId: string,
  contactPhone: string,
  globalEnabled: boolean = true
): boolean {
  const key = getMimicKey(userId, contactPhone);
  const explicitSetting = mimicSettings.get(key);
  if (explicitSetting === true) return true;
  if (explicitSetting === false) return false;
  return globalEnabled;
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
  const spamPrefixMatch = trimmed.match(/^!me\s+-s\s+(\d+)\s+-d\s+(\d+)(?:\s+-\s+|\s+)(.+)$/i);
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

  // !mimic status - show which contacts have mimic enabled
  const mimicStatusMatch = trimmed.match(/^!mimic\s+status$/i);
  if (mimicStatusMatch) {
    return {
      type: "mimic_status",
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
        const contactName = getContactName(userId, contactPhone);
        return enabled
          ? `🎭 Mimic mode enabled for ${contactName}`
          : `🎭 Mimic mode disabled for ${contactName}`;

      case "global_mimic":
        const globalEnabled = command.data?.enabled ?? false;
        try {
          await db
            .update(aiSettings)
            .set({ aiEnabled: globalEnabled, updatedAt: new Date() })
            .where(eq(aiSettings.userId, userId));
          return globalEnabled
            ? "✅ Global AI default enabled — contacts with !mimic off remain disabled"
            : "🟡 Global AI default disabled — contacts with !mimic on remain enabled";
        } catch {
          return "❌ Failed to update global AI setting";
        }

      case "mimic_status":
        return await getMimicStatusMessage(userId);

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
      ? `!me -s {count} -d {seconds} {message} (or !${botAlias} -s {count} -d {seconds} {message})`
      : "!me -s {count} -d {seconds} {message}";

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
      "• !me -s {count} -d {seconds} {message} — repeat message with delay",
      "• !mimic on/off — toggle auto-reply for this contact",
      "• !mimic global on/off — set default AI behavior for all contacts",
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
      "  Example: !me -s 10 -d 5 payment reminder",
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

/**
 * Get mimic status for all contacts (top 20 most recent)
 */
async function getMimicStatusMessage(userId: string): Promise<string> {
  try {
    // Get top 20 contacts by most recent message
    const topContacts = await db
      .select({
        contactPhone: waChatMessage.contactPhone,
        lastTs: max(waChatMessage.timestamp),
      })
      .from(waChatMessage)
      .where(
        and(
          eq(waChatMessage.userId, userId),
          eq(waChatMessage.chatType, "direct"),
          sql`${waChatMessage.contactPhone} IS NOT NULL`
        )
      )
      .groupBy(waChatMessage.contactPhone)
      .orderBy(desc(max(waChatMessage.timestamp)))
      .limit(20);

    if (topContacts.length === 0) {
      return "🎭 Mimic Status: No contacts with chat history yet.";
    }

    // Check global AI setting
    const settings = await db
      .select({ aiEnabled: aiSettings.aiEnabled })
      .from(aiSettings)
      .where(eq(aiSettings.userId, userId))
      .then((rows) => rows[0]);

    const globalStatus = settings?.aiEnabled ? "✅ ON" : "❌ OFF";

    // Get mimic status for each contact with proper names
    const contactStatuses = topContacts
      .filter((c): c is typeof c & { contactPhone: string } => Boolean(c.contactPhone))
      .map((c) => {
        const contactName = getContactName(userId, c.contactPhone);
        const mimicEnabled = isMimicEnabledForContact(userId, c.contactPhone, settings?.aiEnabled ?? true);
        const status = mimicEnabled ? "✅" : "❌";
        return `• ${contactName}: ${status}`;
      })
      .join("\n");

    return [
      "🎭 Mimic Status Report (Top 20)",
      "",
      `Global AI Default: ${globalStatus}`,
      "",
      "Per-Contact Status:",
      contactStatuses,
      "",
      "📌 Commands",
      "• !mimic on — enable mimic for this contact",
      "• !mimic off — disable mimic for this contact",
      "• !mimic global on — enable AI for all contacts",
      "• !mimic global off — disable AI for all contacts",
    ].join("\n");
  } catch (error) {
    logger.error("Failed to get mimic status", {
      error: String(error),
      userId,
    });
    return "❌ Unable to retrieve mimic status";
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

  // Contact-specific mimic setting overrides global aiEnabled.
  // If contact has no explicit setting, global aiEnabled is used as default.
  const mimicEnabled = isMimicEnabledForContact(userId, contactPhone, aiEnabled);

  return {
    shouldRespond: mimicEnabled,
    mode: mimicEnabled ? "mimic" : null,
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
