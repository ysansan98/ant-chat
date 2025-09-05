PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_mcp_configs` (
	`server_name` text PRIMARY KEY NOT NULL,
	`icon` text NOT NULL,
	`description` text,
	`timeout` integer DEFAULT 30,
	`transport_type` text NOT NULL,
	`created_at` integer DEFAULT (strftime('%s','now')) NOT NULL,
	`updated_at` integer DEFAULT (strftime('%s','now')) NOT NULL,
	`url` text,
	`headers` text DEFAULT '{}',
	`command` text,
	`args` text DEFAULT 'null',
	`env` text DEFAULT 'null'
);
--> statement-breakpoint
INSERT INTO `__new_mcp_configs`("server_name", "icon", "description", "timeout", "transport_type", "created_at", "updated_at", "url", "headers", "command", "args", "env") SELECT "server_name", "icon", "description", "timeout", "transport_type", "created_at", "updated_at", "url", "headers", "command", "args", "env" FROM `mcp_configs`;--> statement-breakpoint
DROP TABLE `mcp_configs`;--> statement-breakpoint
ALTER TABLE `__new_mcp_configs` RENAME TO `mcp_configs`;--> statement-breakpoint
PRAGMA foreign_keys=ON;