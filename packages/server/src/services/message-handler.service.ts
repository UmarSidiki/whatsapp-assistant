import { eq, and } from "drizzle-orm";
import { db } from "../db";
import { aiSettings, aiPersona } from "../db/schema";
import { logger } from "../lib/logger";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CommandResult {
  type: "explain" | "mimic" | "refresh" | "status" | null;
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

function isMimicEnabledForContact(userId: string, contactPhone: string): boolean {
  return mimicSettings.get(getMimicKey(userId, contactPhone)) ?? false;
}

function setMimicEnabledForContact(
  userId: string,
  contactPhone: string,
  enabled: boolean
): void {
  mimicSettings.set(getMimicKey(userId, contactPhone), enabled);
}

// ─── Command Parsing ──────────────────────────────────────────────────────────

/**
 * Parse message for special commands
 * Supports:
 * - !me <message>          → Explain/answer mode
 * - !mimic on/off          → Toggle persona mimicry
 * - !refresh persona       → Force update persona
 * - !ai status             → Show AI settings
 */
export function parseCommand(message: string): CommandResult {
  const trimmed = message.trim();

  // !me <message> - explain/answer mode
  const meMatch = trimmed.match(/^!me\s+(.+)$/i);
  if (meMatch) {
    return {
      type: "explain",
      content: meMatch[1].trim(),
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
          ? "🎭 Mimic mode enabled - I'll respond in your voice"
          : "🎭 Mimic mode disabled";

      case "refresh":
        // Call refreshPersona logic
        return await refreshPersona(userId, contactPhone);

      case "status":
        return await getAIStatusMessage(userId);

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
    const normalizedPhone = contactPhone.replace(/\D/g, "");

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
      .select()
      .from(aiSettings)
      .where(eq(aiSettings.userId, userId))
      .then((rows) => rows[0]);

    if (!settings) {
      return "⚙️ AI Settings:\n- Status: Not configured\n- Primary Provider: Not set";
    }

    const status = settings.aiEnabled ? "✅ Enabled" : "❌ Disabled";
    const provider = settings.primaryProvider || "groq";
    const fallback = settings.fallbackProvider ? `${settings.fallbackProvider}` : "None";

    return (
      `⚙️ AI Settings:\n` +
      `- Status: ${status}\n` +
      `- Primary Provider: ${provider}\n` +
      `- Fallback Provider: ${fallback}`
    );
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

  // Check if mimic mode is enabled for this contact
  const mimicEnabled = isMimicEnabledForContact(userId, contactPhone);

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

  for (const [key, enabled] of mimicSettings) {
    if (key.startsWith(prefix) && enabled) {
      contacts.push(key.slice(prefix.length));
    }
  }

  return contacts;
}
