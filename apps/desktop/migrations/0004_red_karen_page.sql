PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`created_at` integer DEFAULT (strftime('%s','now')) NOT NULL,
	`updated_at` integer DEFAULT (strftime('%s','now')) NOT NULL,
	`settings` text
);
--> statement-breakpoint
INSERT INTO `__new_conversations`("id", "title", "created_at", "updated_at", "settings") SELECT "id", "title", "create_at" as "created_at", "update_at" as "updated_at", "settings" FROM `conversations`;--> statement-breakpoint
DROP TABLE `conversations`;--> statement-breakpoint
ALTER TABLE `__new_conversations` RENAME TO `conversations`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__new_mcp_configs` (
	`server_name` text PRIMARY KEY NOT NULL,
	`icon` text NOT NULL,
	`description` text,
	`timeout` integer DEFAULT 30,
	`transport_type` text NOT NULL,
	`created_at` integer DEFAULT (strftime('%s','now')) NOT NULL,
	`updated_at` integer DEFAULT (strftime('%s','now')) NOT NULL,
	`url` text,
	`command` text,
	`args` text DEFAULT 'null',
	`env` text DEFAULT 'null'
);
--> statement-breakpoint
INSERT INTO `__new_mcp_configs`("server_name", "icon", "description", "timeout", "transport_type", "created_at", "updated_at", "url", "command", "args", "env") SELECT "server_name", "icon", "description", "timeout", "transport_type", "create_at" as "created_at", "update_at" as "updated_at", "url", "command", "args", "env" FROM `mcp_configs`;--> statement-breakpoint
DROP TABLE `mcp_configs`;--> statement-breakpoint
ALTER TABLE `__new_mcp_configs` RENAME TO `mcp_configs`;--> statement-breakpoint
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
	`model_info` text DEFAULT 'null'
);
--> statement-breakpoint
INSERT INTO `__new_messages`("id", "conv_id", "role", "content", "created_at", "status", "images", "attachments", "reasoning_content", "mcp_tool", "model_info") SELECT "id", "conv_id", "role", "content", "create_at" as "created_at", "status", "images", "attachments", "reasoning_content", "mcp_tool", "model_info" FROM `messages`;--> statement-breakpoint
DROP TABLE `messages`;--> statement-breakpoint
ALTER TABLE `__new_messages` RENAME TO `messages`;--> statement-breakpoint
CREATE TABLE `__new_provider_service_models` (
	`id` text PRIMARY KEY NOT NULL,
	`model` text NOT NULL,
	`is_builtin` integer DEFAULT 0 NOT NULL,
	`is_enabled` integer DEFAULT 1 NOT NULL,
	`model_features` text,
	`provider_service_id` text NOT NULL,
	`created_at` integer DEFAULT (strftime('%s','now')) NOT NULL,
	FOREIGN KEY (`provider_service_id`) REFERENCES `provider_services`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_provider_service_models`("id", "model", "is_builtin", "is_enabled", "model_features", "provider_service_id", "created_at") SELECT "id", "model", "is_builtin", "is_enabled", "model_features", "provider_service_id", "created_at" FROM `provider_service_models`;--> statement-breakpoint
DROP TABLE `provider_service_models`;--> statement-breakpoint
ALTER TABLE `__new_provider_service_models` RENAME TO `provider_service_models`;--> statement-breakpoint
CREATE UNIQUE INDEX `provider_service_models_model_provider_service_id_unique` ON `provider_service_models` (`model`,`provider_service_id`);--> statement-breakpoint
CREATE TABLE `__new_provider_services` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`base_url` text NOT NULL,
	`api_key` text,
	`api_mode` text NOT NULL,
	`is_official` integer DEFAULT false NOT NULL,
	`is_enabled` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (strftime('%s','now')) NOT NULL,
	`updated_at` integer DEFAULT (strftime('%s','now')) NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_provider_services`("id", "name", "base_url", "api_key", "api_mode", "is_official", "is_enabled", "created_at", "updated_at") SELECT "id", "name", "base_url", "api_key", "api_mode", "is_official", "is_enabled", "created_at", "updated_at" FROM `provider_services`;--> statement-breakpoint
DROP TABLE `provider_services`;--> statement-breakpoint
ALTER TABLE `__new_provider_services` RENAME TO `provider_services`;
