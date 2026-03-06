CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`accountId` text NOT NULL,
	`providerId` text NOT NULL,
	`userId` text NOT NULL,
	`accessToken` text,
	`refreshToken` text,
	`idToken` text,
	`accessTokenExpiresAt` integer,
	`refreshTokenExpiresAt` integer,
	`scope` text,
	`password` text,
	`createdAt` integer,
	`updatedAt` integer,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`expiresAt` integer,
	`token` text,
	`createdAt` integer,
	`updatedAt` integer,
	`ipAddress` text,
	`userAgent` text,
	`userId` text NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text,
	`email` text,
	`emailVerified` integer,
	`image` text,
	`createdAt` integer,
	`updatedAt` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expiresAt` integer,
	`createdAt` integer,
	`updatedAt` integer
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
CREATE TABLE `auto_reply_rule` (
`id` text PRIMARY KEY NOT NULL,
`keyword` text NOT NULL,
`response` text NOT NULL,
`matchType` text NOT NULL DEFAULT 'contains',
`enabled` integer NOT NULL DEFAULT 1,
`createdAt` integer NOT NULL,
`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `scheduled_message` (
`id` text PRIMARY KEY NOT NULL,
`phone` text NOT NULL,
`message` text NOT NULL,
`scheduledAt` integer NOT NULL,
`status` text NOT NULL DEFAULT 'pending',
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
CREATE UNIQUE INDEX `template_name_unique` ON `template` (`name`);--> statement-breakpoint
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
`aiEnabled` integer NOT NULL DEFAULT 1,
`primaryProvider` text NOT NULL DEFAULT 'groq',
`fallbackProvider` text,
`createdAt` integer NOT NULL,
`updatedAt` integer NOT NULL,
FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_settings_userId_unique` ON `ai_settings` (`userId`);--> statement-breakpoint
CREATE TABLE `ai_api_usage` (
`id` text PRIMARY KEY NOT NULL,
`userId` text NOT NULL,
`provider` text NOT NULL,
`model` text NOT NULL,
`callCount` integer NOT NULL DEFAULT 0,
`resetAt` integer NOT NULL,
`timestamp` integer NOT NULL,
FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `ai_api_usage_user_provider_reset_idx` ON `ai_api_usage` (`userId`,`provider`,`resetAt`);
