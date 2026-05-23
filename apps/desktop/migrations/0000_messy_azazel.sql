CREATE TABLE `conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`create_at` integer NOT NULL,
	`update_at` integer NOT NULL,
	`settings` text
);
--> statement-breakpoint
CREATE TABLE `custom_models` (
	`id` text PRIMARY KEY NOT NULL,
	`owned_by` text NOT NULL,
	`create_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `mcp_configs` (
	`server_name` text PRIMARY KEY NOT NULL,
	`icon` text NOT NULL,
	`description` text,
	`timeout` integer,
	`transport_type` text NOT NULL,
	`create_at` integer NOT NULL,
	`update_at` integer NOT NULL,
	`url` text,
	`command` text,
	`args` text,
	`env` text
);
--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`conv_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`create_at` integer NOT NULL,
	`status` text NOT NULL,
	`images` text,
	`attachments` text,
	`reasoning_content` text,
	`mcp_tool` text,
	`model_info` text
);
