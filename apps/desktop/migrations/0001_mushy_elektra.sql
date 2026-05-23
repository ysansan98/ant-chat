PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`create_at` integer DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`update_at` integer DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`settings` text
);
--> statement-breakpoint
INSERT INTO `__new_conversations`("id", "title", "create_at", "update_at", "settings") SELECT "id", "title", "create_at", "update_at", "settings" FROM `conversations`;--> statement-breakpoint
DROP TABLE `conversations`;--> statement-breakpoint
ALTER TABLE `__new_conversations` RENAME TO `conversations`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__new_mcp_configs` (
	`server_name` text PRIMARY KEY NOT NULL,
	`icon` text NOT NULL,
	`description` text,
	`timeout` integer,
	`transport_type` text NOT NULL,
	`create_at` integer DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`update_at` integer DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`url` text,
	`command` text,
	`args` text DEFAULT 'null',
	`env` text DEFAULT 'null'
);
--> statement-breakpoint
INSERT INTO `__new_mcp_configs`("server_name", "icon", "description", "timeout", "transport_type", "create_at", "update_at", "url", "command", "args", "env") SELECT "server_name", "icon", "description", "timeout", "transport_type", "create_at", "update_at", "url", "command", "args", "env" FROM `mcp_configs`;--> statement-breakpoint
DROP TABLE `mcp_configs`;--> statement-breakpoint
ALTER TABLE `__new_mcp_configs` RENAME TO `mcp_configs`;--> statement-breakpoint
CREATE TABLE `__new_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`conv_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`create_at` integer NOT NULL,
	`status` text NOT NULL,
	`images` text DEFAULT '[]',
	`attachments` text DEFAULT '[]',
	`reasoning_content` text,
	`mcp_tool` text DEFAULT 'null',
	`model_info` text DEFAULT 'null'
);
--> statement-breakpoint
INSERT INTO `__new_messages`("id", "conv_id", "role", "content", "create_at", "status", "images", "attachments", "reasoning_content", "mcp_tool", "model_info") SELECT "id", "conv_id", "role", "content", "create_at", "status", "images", "attachments", "reasoning_content", "mcp_tool", "model_info" FROM `messages`;--> statement-breakpoint
DROP TABLE `messages`;--> statement-breakpoint
ALTER TABLE `__new_messages` RENAME TO `messages`;