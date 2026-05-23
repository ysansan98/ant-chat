PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_mcp_configs` (
	`server_name` text PRIMARY KEY NOT NULL,
	`icon` text NOT NULL,
	`description` text,
	`timeout` integer DEFAULT 30,
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
PRAGMA foreign_keys=ON;