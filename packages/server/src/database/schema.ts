import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name"),
  email: text("email").unique(),
  emailVerified: integer("emailVerified", { mode: "boolean" }),
  image: text("image"),
  role: text("role", { enum: ["user", "admin"] }).notNull().default("user"),
  tier: text("tier", { enum: ["marketing", "management"] }).default("marketing"),
  suspendedAt: integer("suspendedAt", { mode: "timestamp" }),
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

// ─── Admin Tables ─────────────────────────────────────────────────────────────

export const adminAuditLog = sqliteTable("admin_audit_log", {
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
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
}, (t) => [
  index("admin_audit_log_actor_user_idx").on(t.actorUserId),
  index("admin_audit_log_created_at_idx").on(t.createdAt),
]);

export const featureFlag = sqliteTable("feature_flag", {
  id: text("id").primaryKey(),
  key: text("key").notNull().unique(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
  description: text("description"),
  updatedBy: text("updatedBy")
    .notNull()
    .references(() => user.id),
  updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull(),
}, (t) => [
  index("feature_flag_updated_by_idx").on(t.updatedBy),
]);

export const subscription = sqliteTable("subscription", {
  id: text("id").primaryKey(),
  userId: text("userId")
    .notNull()
    .references(() => user.id),
  plan: text("plan").notNull(),
  status: text("status").notNull(),
  startedAt: integer("startedAt", { mode: "timestamp" }).notNull(),
  endsAt: integer("endsAt", { mode: "timestamp" }),
  trialUsed: integer("trialUsed", { mode: "boolean" }).notNull().default(false),
  updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull(),
}, (t) => [
  index("subscription_user_idx").on(t.userId),
  index("subscription_status_idx").on(t.status),
]);

export const invoice = sqliteTable("invoice", {
  id: text("id").primaryKey(),
  userId: text("userId")
    .notNull()
    .references(() => user.id),
  subscriptionId: text("subscriptionId").references(() => subscription.id),
  amount: integer("amount").notNull(),
  currency: text("currency").notNull(),
  status: text("status").notNull(),
  periodStart: integer("periodStart", { mode: "timestamp" }).notNull(),
  periodEnd: integer("periodEnd", { mode: "timestamp" }).notNull(),
  paidAt: integer("paidAt", { mode: "timestamp" }),
}, (t) => [
  index("invoice_user_idx").on(t.userId),
  index("invoice_subscription_idx").on(t.subscriptionId),
  index("invoice_status_idx").on(t.status),
]);

export const securityEvent = sqliteTable("security_event", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  severity: text("severity").notNull(),
  userId: text("userId").references(() => user.id),
  ipAddress: text("ipAddress"),
  detail: text("detail").notNull(),
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
}, (t) => [
  index("security_event_user_idx").on(t.userId),
  index("security_event_type_idx").on(t.type),
  index("security_event_severity_idx").on(t.severity),
  index("security_event_created_at_idx").on(t.createdAt),
]);

// ─── WhatsApp App Tables ──────────────────────────────────────────────────────

/** Track trial usage per phone number (one trial per phone) */
export const trialUsage = sqliteTable("trial_usage", {
  id: text("id").primaryKey(),
  phoneNumber: text("phoneNumber").notNull().unique(),
  userId: text("userId").references(() => user.id),
  trialStartedAt: integer("trialStartedAt", { mode: "timestamp" }).notNull(),
  trialEndsAt: integer("trialEndsAt", { mode: "timestamp" }).notNull(),
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
}, (t) => [
  index("trial_usage_phone_idx").on(t.phoneNumber),
  index("trial_usage_user_idx").on(t.userId),
]);

/** Log of every message sent (single, bulk, scheduled, auto-reply, ai) */
export const messageLog = sqliteTable("message_log", {
  id: text("id").primaryKey(),
  userId: text("userId").references(() => user.id),
  type: text("type", { enum: ["single", "bulk", "scheduled", "auto_reply", "ai", "flow"] }).notNull(),
  phone: text("phone").notNull(),
  message: text("message").notNull(),
  status: text("status", { enum: ["sent", "failed"] }).notNull(),
  error: text("error"),
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
}, (t) => [
  index("message_log_created_at_idx").on(t.createdAt),
  index("message_log_status_idx").on(t.status),
  index("message_log_user_idx").on(t.userId),
]);

/** Persisted auto-reply rules (survive server restarts) */
export const autoReplyRule = sqliteTable("auto_reply_rule", {
  id: text("id").primaryKey(),
  userId: text("userId").references(() => user.id),
  keyword: text("keyword").notNull(),
  response: text("response").notNull(),
  matchType: text("matchType", { enum: ["exact", "contains", "startsWith"] })
    .notNull()
    .default("contains"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull(),
}, (t) => [
  index("auto_reply_rule_user_idx").on(t.userId),
]);

/** Persisted scheduled messages (survive server restarts) */
export const scheduledMessage = sqliteTable("scheduled_message", {
  id: text("id").primaryKey(),
  userId: text("userId").references(() => user.id),
  phone: text("phone").notNull(),
  message: text("message").notNull(),
  scheduledAt: integer("scheduledAt", { mode: "timestamp" }).notNull(),
  status: text("status", { enum: ["pending", "sent", "failed"] }).notNull().default("pending"),
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
}, (t) => [
  index("scheduled_message_user_idx").on(t.userId),
]);

/** Message templates (saved server-side, not just localStorage) */
export const template = sqliteTable("template", {
  id: text("id").primaryKey(),
  userId: text("userId").references(() => user.id),
  name: text("name").notNull(),
  content: text("content").notNull(),
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull(),
}, (t) => [
  index("template_user_idx").on(t.userId),
]);

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
  groqModel: text("groqModel").notNull().default("llama-3.1-8b-instant"),
  fallbackGroqModel: text("fallbackGroqModel"),
  geminiModel: text("geminiModel").notNull().default("gemini-2.0-flash"),
  botName: text("botName"),
  customInstructions: text("customInstructions"),
  timezone: text("timezone").default("UTC"),
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull(),
});

/** Store user API keys for various providers */
export const apiKeys = sqliteTable("api_keys", {
  id: text("id").primaryKey(),
  userId: text("userId")
    .notNull()
    .references(() => user.id),
  provider: text("provider", { enum: ["groq", "gemini"] }).notNull(),
  keyValue: text("keyValue").notNull(),
  name: text("name"),
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
}, (t) => [
  index("api_keys_user_provider_idx").on(t.userId, t.provider),
]);

// ─── Chatbot Flow Tables ──────────────────────────────────────────────────────

/** Visual chatbot flows created via the drag-and-drop builder */
export const chatbotFlow = sqliteTable("chatbot_flow", {
  id: text("id").primaryKey(),
  userId: text("userId")
    .notNull()
    .references(() => user.id),
  name: text("name").notNull(),
  description: text("description"),
  /** JSON-encoded flow definition: { nodes: Node[], edges: Edge[] } */
  flowData: text("flowData").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  priority: integer("priority").notNull().default(0),
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull(),
}, (t) => [
  index("chatbot_flow_user_idx").on(t.userId),
  index("chatbot_flow_user_enabled_idx").on(t.userId, t.enabled),
]);

/** Track API call counts for rate limit fallback */
export const aiApiUsage = sqliteTable("ai_api_usage", {
  id: text("id").primaryKey(),
  userId: text("userId")
    .notNull()
    .references(() => user.id),
  provider: text("provider", { enum: ["groq", "gemini"] }).notNull(),
  model: text("model").notNull(),
  callCount: integer("callCount").notNull().default(0),
  // Dynamic limits from headers
  estimatedLimit: integer("estimatedLimit"), 
  estimatedRemaining: integer("estimatedRemaining"),
  resetAt: integer("resetAt", { mode: "timestamp" }).notNull(),
  timestamp: integer("timestamp", { mode: "timestamp" }).notNull(),
}, (t) => [
  index("ai_api_usage_user_provider_reset_idx").on(t.userId, t.provider, t.resetAt),
]);
