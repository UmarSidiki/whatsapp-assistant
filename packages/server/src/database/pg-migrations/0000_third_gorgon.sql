CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"accountId" text NOT NULL,
	"providerId" text NOT NULL,
	"userId" text NOT NULL,
	"accessToken" text,
	"refreshToken" text,
	"idToken" text,
	"accessTokenExpiresAt" timestamp with time zone,
	"refreshTokenExpiresAt" timestamp with time zone,
	"scope" text,
	"password" text,
	"createdAt" timestamp with time zone,
	"updatedAt" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "admin_audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"actorUserId" text NOT NULL,
	"action" text NOT NULL,
	"targetType" text NOT NULL,
	"targetId" text NOT NULL,
	"metadata" text,
	"ipAddress" text,
	"userAgent" text,
	"createdAt" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_api_usage" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"callCount" integer DEFAULT 0 NOT NULL,
	"estimatedLimit" integer,
	"estimatedRemaining" integer,
	"resetAt" timestamp with time zone NOT NULL,
	"timestamp" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_chat_history" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"contactPhone" text NOT NULL,
	"message" text NOT NULL,
	"sender" text NOT NULL,
	"isOutgoing" boolean NOT NULL,
	"timestamp" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_persona" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"contactPhone" text NOT NULL,
	"persona" text NOT NULL,
	"lastUpdated" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"aiEnabled" boolean DEFAULT true NOT NULL,
	"primaryProvider" text DEFAULT 'groq' NOT NULL,
	"fallbackProvider" text,
	"groqModel" text DEFAULT 'llama-3.1-8b-instant' NOT NULL,
	"fallbackGroqModel" text,
	"geminiModel" text DEFAULT 'gemini-2.0-flash' NOT NULL,
	"botName" text,
	"customInstructions" text,
	"timezone" text DEFAULT 'UTC',
	"createdAt" timestamp with time zone NOT NULL,
	"updatedAt" timestamp with time zone NOT NULL,
	CONSTRAINT "ai_settings_userId_unique" UNIQUE("userId")
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"provider" text NOT NULL,
	"keyValue" text NOT NULL,
	"name" text,
	"createdAt" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auto_reply_rule" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text,
	"keyword" text NOT NULL,
	"response" text NOT NULL,
	"matchType" text DEFAULT 'contains' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp with time zone NOT NULL,
	"updatedAt" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chatbot_flow" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"flowData" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp with time zone NOT NULL,
	"updatedAt" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feature_flag" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"description" text,
	"updatedBy" text NOT NULL,
	"updatedAt" timestamp with time zone NOT NULL,
	CONSTRAINT "feature_flag_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "invoice" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"subscriptionId" text,
	"amount" integer NOT NULL,
	"currency" text NOT NULL,
	"status" text NOT NULL,
	"periodStart" timestamp with time zone NOT NULL,
	"periodEnd" timestamp with time zone NOT NULL,
	"paidAt" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "message_log" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text,
	"type" text NOT NULL,
	"phone" text NOT NULL,
	"message" text NOT NULL,
	"status" text NOT NULL,
	"error" text,
	"createdAt" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scheduled_message" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text,
	"phone" text NOT NULL,
	"message" text NOT NULL,
	"scheduledAt" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"createdAt" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "security_event" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"severity" text NOT NULL,
	"userId" text,
	"ipAddress" text,
	"detail" text NOT NULL,
	"createdAt" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expiresAt" timestamp with time zone,
	"token" text,
	"createdAt" timestamp with time zone,
	"updatedAt" timestamp with time zone,
	"ipAddress" text,
	"userAgent" text,
	"userId" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "subscription" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"plan" text NOT NULL,
	"status" text NOT NULL,
	"startedAt" timestamp with time zone NOT NULL,
	"endsAt" timestamp with time zone,
	"trialUsed" boolean DEFAULT false NOT NULL,
	"updatedAt" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "template" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text,
	"name" text NOT NULL,
	"content" text NOT NULL,
	"createdAt" timestamp with time zone NOT NULL,
	"updatedAt" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trial_usage" (
	"id" text PRIMARY KEY NOT NULL,
	"phoneNumber" text NOT NULL,
	"userId" text,
	"trialStartedAt" timestamp with time zone NOT NULL,
	"trialEndsAt" timestamp with time zone NOT NULL,
	"createdAt" timestamp with time zone NOT NULL,
	CONSTRAINT "trial_usage_phoneNumber_unique" UNIQUE("phoneNumber")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"email" text,
	"emailVerified" boolean,
	"image" text,
	"role" text DEFAULT 'user' NOT NULL,
	"tier" text DEFAULT 'marketing',
	"suspendedAt" timestamp with time zone,
	"createdAt" timestamp with time zone,
	"updatedAt" timestamp with time zone,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expiresAt" timestamp with time zone,
	"createdAt" timestamp with time zone,
	"updatedAt" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_audit_log" ADD CONSTRAINT "admin_audit_log_actorUserId_user_id_fk" FOREIGN KEY ("actorUserId") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_api_usage" ADD CONSTRAINT "ai_api_usage_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_chat_history" ADD CONSTRAINT "ai_chat_history_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_persona" ADD CONSTRAINT "ai_persona_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_settings" ADD CONSTRAINT "ai_settings_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auto_reply_rule" ADD CONSTRAINT "auto_reply_rule_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chatbot_flow" ADD CONSTRAINT "chatbot_flow_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feature_flag" ADD CONSTRAINT "feature_flag_updatedBy_user_id_fk" FOREIGN KEY ("updatedBy") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_subscriptionId_subscription_id_fk" FOREIGN KEY ("subscriptionId") REFERENCES "public"."subscription"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_log" ADD CONSTRAINT "message_log_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_message" ADD CONSTRAINT "scheduled_message_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "security_event" ADD CONSTRAINT "security_event_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription" ADD CONSTRAINT "subscription_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template" ADD CONSTRAINT "template_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trial_usage" ADD CONSTRAINT "trial_usage_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_audit_log_actor_user_idx" ON "admin_audit_log" USING btree ("actorUserId");--> statement-breakpoint
CREATE INDEX "admin_audit_log_created_at_idx" ON "admin_audit_log" USING btree ("createdAt");--> statement-breakpoint
CREATE INDEX "ai_api_usage_user_provider_reset_idx" ON "ai_api_usage" USING btree ("userId","provider","resetAt");--> statement-breakpoint
CREATE INDEX "ai_chat_history_user_contact_timestamp_idx" ON "ai_chat_history" USING btree ("userId","contactPhone","timestamp");--> statement-breakpoint
CREATE INDEX "ai_chat_history_user_contact_idx" ON "ai_chat_history" USING btree ("userId","contactPhone");--> statement-breakpoint
CREATE INDEX "ai_persona_user_contact_idx" ON "ai_persona" USING btree ("userId","contactPhone");--> statement-breakpoint
CREATE INDEX "api_keys_user_provider_idx" ON "api_keys" USING btree ("userId","provider");--> statement-breakpoint
CREATE INDEX "auto_reply_rule_user_idx" ON "auto_reply_rule" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "chatbot_flow_user_idx" ON "chatbot_flow" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "chatbot_flow_user_enabled_idx" ON "chatbot_flow" USING btree ("userId","enabled");--> statement-breakpoint
CREATE INDEX "feature_flag_updated_by_idx" ON "feature_flag" USING btree ("updatedBy");--> statement-breakpoint
CREATE INDEX "invoice_user_idx" ON "invoice" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "invoice_subscription_idx" ON "invoice" USING btree ("subscriptionId");--> statement-breakpoint
CREATE INDEX "invoice_status_idx" ON "invoice" USING btree ("status");--> statement-breakpoint
CREATE INDEX "message_log_created_at_idx" ON "message_log" USING btree ("createdAt");--> statement-breakpoint
CREATE INDEX "message_log_status_idx" ON "message_log" USING btree ("status");--> statement-breakpoint
CREATE INDEX "message_log_user_idx" ON "message_log" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "scheduled_message_user_idx" ON "scheduled_message" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "security_event_user_idx" ON "security_event" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "security_event_type_idx" ON "security_event" USING btree ("type");--> statement-breakpoint
CREATE INDEX "security_event_severity_idx" ON "security_event" USING btree ("severity");--> statement-breakpoint
CREATE INDEX "security_event_created_at_idx" ON "security_event" USING btree ("createdAt");--> statement-breakpoint
CREATE INDEX "subscription_user_idx" ON "subscription" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "subscription_status_idx" ON "subscription" USING btree ("status");--> statement-breakpoint
CREATE INDEX "template_user_idx" ON "template" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "trial_usage_phone_idx" ON "trial_usage" USING btree ("phoneNumber");--> statement-breakpoint
CREATE INDEX "trial_usage_user_idx" ON "trial_usage" USING btree ("userId");