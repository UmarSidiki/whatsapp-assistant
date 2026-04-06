CREATE TABLE `trial_usage` (
	`id` text PRIMARY KEY NOT NULL,
	`phoneNumber` text NOT NULL,
	`userId` text,
	`trialStartedAt` integer NOT NULL,
	`trialEndsAt` integer NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trial_usage_phoneNumber_unique` ON `trial_usage` (`phoneNumber`);--> statement-breakpoint
CREATE INDEX `trial_usage_phone_idx` ON `trial_usage` (`phoneNumber`);--> statement-breakpoint
CREATE INDEX `trial_usage_user_idx` ON `trial_usage` (`userId`);--> statement-breakpoint
ALTER TABLE `user` ADD `tier` text DEFAULT 'marketing';