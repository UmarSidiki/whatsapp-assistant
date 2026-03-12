CREATE TABLE `chatbot_flow` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`flowData` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `chatbot_flow_user_idx` ON `chatbot_flow` (`userId`);--> statement-breakpoint
CREATE INDEX `chatbot_flow_user_enabled_idx` ON `chatbot_flow` (`userId`,`enabled`);