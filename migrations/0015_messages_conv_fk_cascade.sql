PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`conv_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`created_at` integer DEFAULT (strftime('%s','now')) NOT NULL,
	`status` text NOT NULL,
	`images` text DEFAULT '[]',
	`attachments` text DEFAULT '[]',
	`reasoning_content` text,
	`mcp_tool` text DEFAULT 'null',
	`model_info` text DEFAULT 'null',
	FOREIGN KEY (`conv_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_messages`("id", "conv_id", "role", "content", "created_at", "status", "images", "attachments", "reasoning_content", "mcp_tool", "model_info") SELECT "id", "conv_id", "role", "content", "created_at", "status", "images", "attachments", "reasoning_content", "mcp_tool", "model_info" FROM `messages`;--> statement-breakpoint
DROP TABLE `messages`;--> statement-breakpoint
ALTER TABLE `__new_messages` RENAME TO `messages`;--> statement-breakpoint
PRAGMA foreign_keys=ON;
