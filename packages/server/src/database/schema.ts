import { pgTable, text, integer, boolean, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name"),
  email: text("email").unique(),
  emailVerified: boolean("emailVerified"),
  image: text("image"),
  role: text("role").$type<"user" | "admin">().notNull().default("user"),
  tier: text("tier").$type<"marketing" | "management">().default("marketing"),
  suspendedAt: timestamp("suspendedAt", { withTimezone: true, mode: "date" }),
  createdAt: timestamp("createdAt", { withTimezone: true, mode: "date" }),
  updatedAt: timestamp("updatedAt", { withTimezone: true, mode: "date" }),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expiresAt", { withTimezone: true, mode: "date" }),
  token: text("token").unique(),
  createdAt: timestamp("createdAt", { withTimezone: true, mode: "date" }),
  updatedAt: timestamp("updatedAt", { withTimezone: true, mode: "date" }),
  ipAddress: text("ipAddress"),
  userAgent: text("userAgent"),
  userId: text("userId")
    .notNull()
    .references(() => user.id),
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("accountId").notNull(),
  providerId: text("providerId").notNull(),
  userId: text("userId")
    .notNull()
    .references(() => user.id),
  accessToken: text("accessToken"),
  refreshToken: text("refreshToken"),
  idToken: text("idToken"),
  accessTokenExpiresAt: timestamp("accessTokenExpiresAt", { withTimezone: true, mode: "date" }),
  refreshTokenExpiresAt: timestamp("refreshTokenExpiresAt", { withTimezone: true, mode: "date" }),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("createdAt", { withTimezone: true, mode: "date" }),
  updatedAt: timestamp("updatedAt", { withTimezone: true, mode: "date" }),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expiresAt", { withTimezone: true, mode: "date" }),
  createdAt: timestamp("createdAt", { withTimezone: true, mode: "date" }),
  updatedAt: timestamp("updatedAt", { withTimezone: true, mode: "date" }),
});

// ─── Admin Tables ─────────────────────────────────────────────────────────────

export const adminAuditLog = pgTable("admin_audit_log", {
  id: text("id").primaryKey(),
  actorUserId: text("actorUserId")
    .notNull()
    .references(() => user.id),
  action: text("action").notNull(),
  targetType: text("targetType").notNull(),
  targetId: text("targetId").notNull(),
  metadata: text("metadata"),
  ipAddress: text("ipAddress"),
  userAgent: text("userAgent"),
  createdAt: timestamp("createdAt", { withTimezone: true, mode: "date" }).notNull(),
}, (t) => [
  index("admin_audit_log_actor_user_idx").on(t.actorUserId),
  index("admin_audit_log_created_at_idx").on(t.createdAt),
]);

export const featureFlag = pgTable("feature_flag", {
  id: text("id").primaryKey(),
  key: text("key").notNull().unique(),
  enabled: boolean("enabled").notNull().default(false),
  description: text("description"),
  updatedBy: text("updatedBy")
    .notNull()
    .references(() => user.id),
  updatedAt: timestamp("updatedAt", { withTimezone: true, mode: "date" }).notNull(),
}, (t) => [
  index("feature_flag_updated_by_idx").on(t.updatedBy),
]);

export const subscription = pgTable("subscription", {
  id: text("id").primaryKey(),
  userId: text("userId")
    .notNull()
    .references(() => user.id),
  plan: text("plan").notNull(),
  status: text("status").notNull(),
  startedAt: timestamp("startedAt", { withTimezone: true, mode: "date" }).notNull(),
  endsAt: timestamp("endsAt", { withTimezone: true, mode: "date" }),
  trialUsed: boolean("trialUsed").notNull().default(false),
  updatedAt: timestamp("updatedAt", { withTimezone: true, mode: "date" }).notNull(),
}, (t) => [
  index("subscription_user_idx").on(t.userId),
  index("subscription_status_idx").on(t.status),
]);

export const invoice = pgTable("invoice", {
  id: text("id").primaryKey(),
  userId: text("userId")
    .notNull()
    .references(() => user.id),
  subscriptionId: text("subscriptionId").references(() => subscription.id),
  amount: integer("amount").notNull(),
  currency: text("currency").notNull(),
  status: text("status").notNull(),
  periodStart: timestamp("periodStart", { withTimezone: true, mode: "date" }).notNull(),
  periodEnd: timestamp("periodEnd", { withTimezone: true, mode: "date" }).notNull(),
  paidAt: timestamp("paidAt", { withTimezone: true, mode: "date" }),
}, (t) => [
  index("invoice_user_idx").on(t.userId),
  index("invoice_subscription_idx").on(t.subscriptionId),
  index("invoice_status_idx").on(t.status),
]);

export const securityEvent = pgTable("security_event", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  severity: text("severity").notNull(),
  userId: text("userId").references(() => user.id),
  ipAddress: text("ipAddress"),
  detail: text("detail").notNull(),
  createdAt: timestamp("createdAt", { withTimezone: true, mode: "date" }).notNull(),
}, (t) => [
  index("security_event_user_idx").on(t.userId),
  index("security_event_type_idx").on(t.type),
  index("security_event_severity_idx").on(t.severity),
  index("security_event_created_at_idx").on(t.createdAt),
]);

// ─── WhatsApp App Tables ──────────────────────────────────────────────────────

/** Track trial usage per phone number (one trial per phone) */
export const trialUsage = pgTable("trial_usage", {
  id: text("id").primaryKey(),
  phoneNumber: text("phoneNumber").notNull().unique(),
  userId: text("userId").references(() => user.id),
  trialStartedAt: timestamp("trialStartedAt", { withTimezone: true, mode: "date" }).notNull(),
  trialEndsAt: timestamp("trialEndsAt", { withTimezone: true, mode: "date" }).notNull(),
  createdAt: timestamp("createdAt", { withTimezone: true, mode: "date" }).notNull(),
}, (t) => [
  index("trial_usage_phone_idx").on(t.phoneNumber),
  index("trial_usage_user_idx").on(t.userId),
]);

/** Log of every message sent (single, bulk, scheduled, auto-reply, ai) */
export const messageLog = pgTable("message_log", {
  id: text("id").primaryKey(),
  userId: text("userId").references(() => user.id),
  type: text("type").$type<"single" | "bulk" | "scheduled" | "auto_reply" | "ai" | "flow">().notNull(),
  phone: text("phone").notNull(),
  message: text("message").notNull(),
  status: text("status").$type<"sent" | "failed">().notNull(),
  error: text("error"),
  createdAt: timestamp("createdAt", { withTimezone: true, mode: "date" }).notNull(),
}, (t) => [
  index("message_log_created_at_idx").on(t.createdAt),
  index("message_log_status_idx").on(t.status),
  index("message_log_user_idx").on(t.userId),
]);

/** Persisted auto-reply rules (survive server restarts) */
export const autoReplyRule = pgTable("auto_reply_rule", {
  id: text("id").primaryKey(),
  userId: text("userId").references(() => user.id),
  keyword: text("keyword").notNull(),
  response: text("response").notNull(),
  matchType: text("matchType").$type<"exact" | "contains" | "startsWith">()
    .notNull()
    .default("contains"),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("createdAt", { withTimezone: true, mode: "date" }).notNull(),
  updatedAt: timestamp("updatedAt", { withTimezone: true, mode: "date" }).notNull(),
}, (t) => [
  index("auto_reply_rule_user_idx").on(t.userId),
]);

/** Persisted scheduled messages (survive server restarts) */
export const scheduledMessage = pgTable("scheduled_message", {
  id: text("id").primaryKey(),
  userId: text("userId").references(() => user.id),
  phone: text("phone").notNull(),
  message: text("message").notNull(),
  scheduledAt: timestamp("scheduledAt", { withTimezone: true, mode: "date" }).notNull(),
  status: text("status").$type<"pending" | "sent" | "failed">().notNull().default("pending"),
  createdAt: timestamp("createdAt", { withTimezone: true, mode: "date" }).notNull(),
}, (t) => [
  index("scheduled_message_user_idx").on(t.userId),
]);

/** Message templates (saved server-side, not just localStorage) */
export const template = pgTable("template", {
  id: text("id").primaryKey(),
  userId: text("userId").references(() => user.id),
  name: text("name").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("createdAt", { withTimezone: true, mode: "date" }).notNull(),
  updatedAt: timestamp("updatedAt", { withTimezone: true, mode: "date" }).notNull(),
}, (t) => [
  index("template_user_idx").on(t.userId),
]);

/** Persisted WhatsApp chat messages for dashboard chats/communities */
export const waChatMessage = pgTable("wa_chat_message", {
  id: text("id").primaryKey(),
  userId: text("userId")
    .notNull()
    .references(() => user.id),
  chatId: text("chatId").notNull(),
  chatType: text("chatType").$type<"direct" | "group" | "broadcast" | "channel">().notNull(),
  title: text("title"),
  message: text("message").notNull(),
  sender: text("sender").$type<"me" | "contact">().notNull(),
  timestamp: timestamp("timestamp", { withTimezone: true, mode: "date" }).notNull(),
  createdAt: timestamp("createdAt", { withTimezone: true, mode: "date" }).notNull(),
  /** When set, dashboard can re-download bytes via Baileys (JSON + BufferJSON). */
  waMessagePayload: text("waMessagePayload"),
  mediaKind: text("mediaKind"),
}, (t) => [
  index("wa_chat_message_user_type_ts_idx").on(t.userId, t.chatType, t.timestamp),
  index("wa_chat_message_user_chat_ts_idx").on(t.userId, t.chatId, t.timestamp),
  index("wa_chat_message_user_chat_idx").on(t.userId, t.chatId),
]);

/** Persistent chat list: stores every chat (direct/group) synced from WhatsApp. */
export const waChat = pgTable("wa_chat", {
  /** Composite key: `${userId}::${chatId}` */
  id: text("id").primaryKey(),
  userId: text("userId")
    .notNull()
    .references(() => user.id),
  chatId: text("chatId").notNull(),
  chatType: text("chatType").$type<"direct" | "group" | "broadcast" | "channel">().notNull(),
  title: text("title"),
  lastMessage: text("lastMessage"),
  lastMessageAt: timestamp("lastMessageAt", { withTimezone: true, mode: "date" }),
  unreadCount: integer("unreadCount").notNull().default(0),
  /** Epoch seconds from Baileys conversationTimestamp */
  conversationTimestamp: integer("conversationTimestamp"),
  updatedAt: timestamp("updatedAt", { withTimezone: true, mode: "date" }).notNull(),
}, (t) => [
  index("wa_chat_user_type_idx").on(t.userId, t.chatType),
  index("wa_chat_user_chatid_idx").on(t.userId, t.chatId),
]);

/** Per-user WhatsApp dashboard settings */
export const waChatSettings = pgTable("wa_chat_settings", {
  id: text("id").primaryKey(),
  userId: text("userId")
    .notNull()
    .references(() => user.id)
    .unique(),
  historyLimit: integer("historyLimit").notNull().default(1000),
  createdAt: timestamp("createdAt", { withTimezone: true, mode: "date" }).notNull(),
  updatedAt: timestamp("updatedAt", { withTimezone: true, mode: "date" }).notNull(),
}, (t) => [
  index("wa_chat_settings_user_idx").on(t.userId),
]);

// ─── AI Assistant Tables ──────────────────────────────────────────────────────

/** Store all messages per contact for AI context */
export const aiChatHistory = pgTable("ai_chat_history", {
  id: text("id").primaryKey(),
  userId: text("userId")
    .notNull()
    .references(() => user.id),
  contactPhone: text("contactPhone").notNull(),
  message: text("message").notNull(),
  sender: text("sender").$type<"me" | "contact">().notNull(),
  isOutgoing: boolean("isOutgoing").notNull(),
  timestamp: timestamp("timestamp", { withTimezone: true, mode: "date" }).notNull(),
}, (t) => [
  index("ai_chat_history_user_contact_timestamp_idx").on(t.userId, t.contactPhone, t.timestamp),
  index("ai_chat_history_user_contact_idx").on(t.userId, t.contactPhone),
]);

/** Cached extracted persona per contact */
export const aiPersona = pgTable("ai_persona", {
  id: text("id").primaryKey(),
  userId: text("userId")
    .notNull()
    .references(() => user.id),
  contactPhone: text("contactPhone").notNull(),
  persona: text("persona").notNull(),
  lastUpdated: timestamp("lastUpdated", { withTimezone: true, mode: "date" }).notNull(),
}, (t) => [
  index("ai_persona_user_contact_idx").on(t.userId, t.contactPhone),
]);

/** Global AI settings per user */
export const aiSettings = pgTable("ai_settings", {
  id: text("id").primaryKey(),
  userId: text("userId")
    .notNull()
    .references(() => user.id)
    .unique(),
  aiEnabled: boolean("aiEnabled").notNull().default(true),
  primaryProvider: text("primaryProvider").$type<"groq" | "gemini">()
    .notNull()
    .default("groq"),
  fallbackProvider: text("fallbackProvider").$type<"groq" | "gemini">(),
  groqModel: text("groqModel").notNull().default("llama-3.1-8b-instant"),
  fallbackGroqModel: text("fallbackGroqModel"),
  geminiModel: text("geminiModel").notNull().default("gemini-2.0-flash"),
  botName: text("botName"),
  customInstructions: text("customInstructions"),
  timezone: text("timezone").default("UTC"),
  createdAt: timestamp("createdAt", { withTimezone: true, mode: "date" }).notNull(),
  updatedAt: timestamp("updatedAt", { withTimezone: true, mode: "date" }).notNull(),
});

/** Store user API keys for various providers */
export const apiKeys = pgTable("api_keys", {
  id: text("id").primaryKey(),
  userId: text("userId")
    .notNull()
    .references(() => user.id),
  provider: text("provider").$type<"groq" | "gemini">().notNull(),
  keyValue: text("keyValue").notNull(),
  name: text("name"),
  createdAt: timestamp("createdAt", { withTimezone: true, mode: "date" }).notNull(),
}, (t) => [
  index("api_keys_user_provider_idx").on(t.userId, t.provider),
]);

// ─── Chatbot Flow Tables ──────────────────────────────────────────────────────

/** Visual chatbot flows created via the drag-and-drop builder */
export const chatbotFlow = pgTable("chatbot_flow", {
  id: text("id").primaryKey(),
  userId: text("userId")
    .notNull()
    .references(() => user.id),
  name: text("name").notNull(),
  description: text("description"),
  /** JSON-encoded flow definition: { nodes: Node[], edges: Edge[] } */
  flowData: text("flowData").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  priority: integer("priority").notNull().default(0),
  createdAt: timestamp("createdAt", { withTimezone: true, mode: "date" }).notNull(),
  updatedAt: timestamp("updatedAt", { withTimezone: true, mode: "date" }).notNull(),
}, (t) => [
  index("chatbot_flow_user_idx").on(t.userId),
  index("chatbot_flow_user_enabled_idx").on(t.userId, t.enabled),
]);

/** Per-contact flow trigger runtime state (for inactivity-window trigger modes). */
export const flowTriggerState = pgTable("flow_trigger_state", {
  id: text("id").primaryKey(),
  userId: text("userId")
    .notNull()
    .references(() => user.id),
  flowId: text("flowId")
    .notNull()
    .references(() => chatbotFlow.id),
  triggerNodeId: text("triggerNodeId").notNull(),
  contactPhone: text("contactPhone").notNull(),
  lastMessageAt: timestamp("lastMessageAt", { withTimezone: true, mode: "date" }).notNull(),
  sessionActive: boolean("sessionActive").notNull().default(true),
  createdAt: timestamp("createdAt", { withTimezone: true, mode: "date" }).notNull(),
  updatedAt: timestamp("updatedAt", { withTimezone: true, mode: "date" }).notNull(),
}, (t) => [
  index("flow_trigger_state_user_idx").on(t.userId),
  index("flow_trigger_state_flow_idx").on(t.flowId),
  index("flow_trigger_state_lookup_idx").on(t.userId, t.contactPhone, t.updatedAt),
  uniqueIndex("flow_trigger_state_unique_idx").on(t.userId, t.flowId, t.triggerNodeId, t.contactPhone),
]);

/** Track API call counts for rate limit fallback */
export const aiApiUsage = pgTable("ai_api_usage", {
  id: text("id").primaryKey(),
  userId: text("userId")
    .notNull()
    .references(() => user.id),
  provider: text("provider").$type<"groq" | "gemini">().notNull(),
  model: text("model").notNull(),
  callCount: integer("callCount").notNull().default(0),
  // Dynamic limits from headers
  estimatedLimit: integer("estimatedLimit"), 
  estimatedRemaining: integer("estimatedRemaining"),
  resetAt: timestamp("resetAt", { withTimezone: true, mode: "date" }).notNull(),
  timestamp: timestamp("timestamp", { withTimezone: true, mode: "date" }).notNull(),
}, (t) => [
  index("ai_api_usage_user_provider_reset_idx").on(t.userId, t.provider, t.resetAt),
]);
