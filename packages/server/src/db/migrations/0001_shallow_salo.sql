CREATE TABLE `ai_api_usage` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`callCount` integer DEFAULT 0 NOT NULL,
	`resetAt` integer NOT NULL,
	`timestamp` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `ai_api_usage_user_provider_reset_idx` ON `ai_api_usage` (`userId`,`provider`,`resetAt`);--> statement-breakpoint
CREATE TABLE `ai_chat_history` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`contactPhone` text NOT NULL,
	`message` text NOT NULL,
	`sender` text NOT NULL,
	`isOutgoing` integer NOT NULL,
	`timestamp` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `ai_chat_history_user_contact_timestamp_idx` ON `ai_chat_history` (`userId`,`contactPhone`,`timestamp`);--> statement-breakpoint
CREATE INDEX `ai_chat_history_user_contact_idx` ON `ai_chat_history` (`userId`,`contactPhone`);--> statement-breakpoint
CREATE TABLE `ai_persona` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`contactPhone` text NOT NULL,
	`persona` text NOT NULL,
	`lastUpdated` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `ai_persona_user_contact_idx` ON `ai_persona` (`userId`,`contactPhone`);--> statement-breakpoint
CREATE TABLE `ai_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`aiEnabled` integer DEFAULT true NOT NULL,
	`primaryProvider` text DEFAULT 'groq' NOT NULL,
	`fallbackProvider` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_settings_userId_unique` ON `ai_settings` (`userId`);--> statement-breakpoint
CREATE TABLE `auto_reply_rule` (
	`id` text PRIMARY KEY NOT NULL,
	`keyword` text NOT NULL,
	`response` text NOT NULL,
	`matchType` text DEFAULT 'contains' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `message_log` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`phone` text NOT NULL,
	`message` text NOT NULL,
	`status` text NOT NULL,
	`error` text,
	`createdAt` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `message_log_created_at_idx` ON `message_log` (`createdAt`);--> statement-breakpoint
CREATE INDEX `message_log_status_idx` ON `message_log` (`status`);--> statement-breakpoint
CREATE TABLE `scheduled_message` (
	`id` text PRIMARY KEY NOT NULL,
	`phone` text NOT NULL,
	`message` text NOT NULL,
	`scheduledAt` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`createdAt` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `template` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`content` text NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `template_name_unique` ON `template` (`name`);