CREATE TABLE `admin_audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`actorUserId` text NOT NULL,
	`action` text NOT NULL,
	`targetType` text NOT NULL,
	`targetId` text NOT NULL,
	`metadata` text,
	`ipAddress` text,
	`userAgent` text,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`actorUserId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `admin_audit_log_actor_user_idx` ON `admin_audit_log` (`actorUserId`);--> statement-breakpoint
CREATE INDEX `admin_audit_log_created_at_idx` ON `admin_audit_log` (`createdAt`);--> statement-breakpoint
CREATE TABLE `feature_flag` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`description` text,
	`updatedBy` text NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`updatedBy`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `feature_flag_key_unique` ON `feature_flag` (`key`);--> statement-breakpoint
CREATE INDEX `feature_flag_updated_by_idx` ON `feature_flag` (`updatedBy`);--> statement-breakpoint
CREATE TABLE `invoice` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`subscriptionId` text,
	`amount` integer NOT NULL,
	`currency` text NOT NULL,
	`status` text NOT NULL,
	`periodStart` integer NOT NULL,
	`periodEnd` integer NOT NULL,
	`paidAt` integer,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`subscriptionId`) REFERENCES `subscription`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `invoice_user_idx` ON `invoice` (`userId`);--> statement-breakpoint
CREATE INDEX `invoice_subscription_idx` ON `invoice` (`subscriptionId`);--> statement-breakpoint
CREATE INDEX `invoice_status_idx` ON `invoice` (`status`);--> statement-breakpoint
CREATE TABLE `security_event` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`severity` text NOT NULL,
	`userId` text,
	`ipAddress` text,
	`detail` text NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `security_event_user_idx` ON `security_event` (`userId`);--> statement-breakpoint
CREATE INDEX `security_event_type_idx` ON `security_event` (`type`);--> statement-breakpoint
CREATE INDEX `security_event_severity_idx` ON `security_event` (`severity`);--> statement-breakpoint
CREATE INDEX `security_event_created_at_idx` ON `security_event` (`createdAt`);--> statement-breakpoint
CREATE TABLE `subscription` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`plan` text NOT NULL,
	`status` text NOT NULL,
	`startedAt` integer NOT NULL,
	`endsAt` integer,
	`trialUsed` integer DEFAULT false NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `subscription_user_idx` ON `subscription` (`userId`);--> statement-breakpoint
CREATE INDEX `subscription_status_idx` ON `subscription` (`status`);