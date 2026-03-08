DROP INDEX `template_name_unique`;--> statement-breakpoint
ALTER TABLE `template` ADD `userId` text REFERENCES user(id);--> statement-breakpoint
CREATE INDEX `template_user_idx` ON `template` (`userId`);--> statement-breakpoint
ALTER TABLE `auto_reply_rule` ADD `userId` text REFERENCES user(id);--> statement-breakpoint
CREATE INDEX `auto_reply_rule_user_idx` ON `auto_reply_rule` (`userId`);--> statement-breakpoint
ALTER TABLE `message_log` ADD `userId` text REFERENCES user(id);--> statement-breakpoint
CREATE INDEX `message_log_user_idx` ON `message_log` (`userId`);--> statement-breakpoint
ALTER TABLE `scheduled_message` ADD `userId` text REFERENCES user(id);--> statement-breakpoint
CREATE INDEX `scheduled_message_user_idx` ON `scheduled_message` (`userId`);