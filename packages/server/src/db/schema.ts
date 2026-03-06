import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name"),
  email: text("email").unique(),
  emailVerified: integer("emailVerified", { mode: "boolean" }),
  image: text("image"),
  createdAt: integer("createdAt", { mode: "timestamp" }),
  updatedAt: integer("updatedAt", { mode: "timestamp" }),
});

export const session = sqliteTable("session", {
  id: text("id").primaryKey(),
  expiresAt: integer("expiresAt", { mode: "timestamp" }),
  token: text("token").unique(),
  createdAt: integer("createdAt", { mode: "timestamp" }),
  updatedAt: integer("updatedAt", { mode: "timestamp" }),
  ipAddress: text("ipAddress"),
  userAgent: text("userAgent"),
  userId: text("userId")
    .notNull()
    .references(() => user.id),
});

export const account = sqliteTable("account", {
  id: text("id").primaryKey(),
  accountId: text("accountId").notNull(),
  providerId: text("providerId").notNull(),
  userId: text("userId")
    .notNull()
    .references(() => user.id),
  accessToken: text("accessToken"),
  refreshToken: text("refreshToken"),
  idToken: text("idToken"),
  accessTokenExpiresAt: integer("accessTokenExpiresAt", { mode: "timestamp" }),
  refreshTokenExpiresAt: integer("refreshTokenExpiresAt", {
    mode: "timestamp",
  }),
  scope: text("scope"),
  password: text("password"),
  createdAt: integer("createdAt", { mode: "timestamp" }),
  updatedAt: integer("updatedAt", { mode: "timestamp" }),
});

export const verification = sqliteTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: integer("expiresAt", { mode: "timestamp" }),
  createdAt: integer("createdAt", { mode: "timestamp" }),
  updatedAt: integer("updatedAt", { mode: "timestamp" }),
});

// ─── WhatsApp App Tables ──────────────────────────────────────────────────────

/** Log of every message sent (single, bulk, scheduled, auto-reply) */
export const messageLog = sqliteTable("message_log", {
  id: text("id").primaryKey(),
  type: text("type", { enum: ["single", "bulk", "scheduled", "auto_reply"] }).notNull(),
  phone: text("phone").notNull(),
  message: text("message").notNull(),
  status: text("status", { enum: ["sent", "failed"] }).notNull(),
  error: text("error"),
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
}, (t) => [
  index("message_log_created_at_idx").on(t.createdAt),
  index("message_log_status_idx").on(t.status),
]);

/** Persisted auto-reply rules (survive server restarts) */
export const autoReplyRule = sqliteTable("auto_reply_rule", {
  id: text("id").primaryKey(),
  keyword: text("keyword").notNull(),
  response: text("response").notNull(),
  matchType: text("matchType", { enum: ["exact", "contains", "startsWith"] })
    .notNull()
    .default("contains"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull(),
});

/** Persisted scheduled messages (survive server restarts) */
export const scheduledMessage = sqliteTable("scheduled_message", {
  id: text("id").primaryKey(),
  phone: text("phone").notNull(),
  message: text("message").notNull(),
  scheduledAt: integer("scheduledAt", { mode: "timestamp" }).notNull(),
  status: text("status", { enum: ["pending", "sent", "failed"] }).notNull().default("pending"),
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
});

/** Message templates (saved server-side, not just localStorage) */
export const template = sqliteTable("template", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  content: text("content").notNull(),
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull(),
});

// ─── AI Assistant Tables ──────────────────────────────────────────────────────

/** Store all messages per contact for AI context */
export const aiChatHistory = sqliteTable("ai_chat_history", {
  id: text("id").primaryKey(),
  userId: text("userId")
    .notNull()
    .references(() => user.id),
  contactPhone: text("contactPhone").notNull(),
  message: text("message").notNull(),
  sender: text("sender", { enum: ["me", "contact"] }).notNull(),
  isOutgoing: integer("isOutgoing", { mode: "boolean" }).notNull(),
  timestamp: integer("timestamp", { mode: "timestamp" }).notNull(),
}, (t) => [
  index("ai_chat_history_user_contact_timestamp_idx").on(t.userId, t.contactPhone, t.timestamp),
  index("ai_chat_history_user_contact_idx").on(t.userId, t.contactPhone),
]);

/** Cached extracted persona per contact */
export const aiPersona = sqliteTable("ai_persona", {
  id: text("id").primaryKey(),
  userId: text("userId")
    .notNull()
    .references(() => user.id),
  contactPhone: text("contactPhone").notNull(),
  persona: text("persona").notNull(),
  lastUpdated: integer("lastUpdated", { mode: "timestamp" }).notNull(),
}, (t) => [
  index("ai_persona_user_contact_idx").on(t.userId, t.contactPhone),
]);

/** Global AI settings per user */
export const aiSettings = sqliteTable("ai_settings", {
  id: text("id").primaryKey(),
  userId: text("userId")
    .notNull()
    .references(() => user.id)
    .unique(),
  aiEnabled: integer("aiEnabled", { mode: "boolean" }).notNull().default(true),
  primaryProvider: text("primaryProvider", { enum: ["groq", "gemini"] })
    .notNull()
    .default("groq"),
  fallbackProvider: text("fallbackProvider", { enum: ["groq", "gemini"] }),
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull(),
});

/** Track API call counts for rate limit fallback */
export const aiApiUsage = sqliteTable("ai_api_usage", {
  id: text("id").primaryKey(),
  userId: text("userId")
    .notNull()
    .references(() => user.id),
  provider: text("provider", { enum: ["groq", "gemini"] }).notNull(),
  model: text("model").notNull(),
  callCount: integer("callCount").notNull().default(0),
  resetAt: integer("resetAt", { mode: "timestamp" }).notNull(),
  timestamp: integer("timestamp", { mode: "timestamp" }).notNull(),
}, (t) => [
  index("ai_api_usage_user_provider_reset_idx").on(t.userId, t.provider, t.resetAt),
]);
