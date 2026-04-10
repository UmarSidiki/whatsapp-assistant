export type ChatType = "direct" | "group" | "broadcast" | "channel";

export function normalizeChatId(jid: string): string {
  return jid.trim().toLowerCase();
}

export function resolveChatTypeFromJid(jid: string): ChatType | null {
  const normalized = normalizeChatId(jid);
  if (!normalized || normalized === "status@broadcast") {
    return null;
  }
  if (normalized.endsWith("@g.us")) return "group";
  if (normalized.endsWith("@newsletter")) return "channel";
  if (normalized.endsWith("@broadcast")) return "broadcast";
  return "direct";
}
