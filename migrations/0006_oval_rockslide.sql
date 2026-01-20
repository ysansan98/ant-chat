PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_provider_services` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`base_url` text NOT NULL,
	`api_key` text DEFAULT '' NOT NULL,
	`api_mode` text NOT NULL,
	`is_official` integer DEFAULT false NOT NULL,
	`is_enabled` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (strftime('%s','now')) NOT NULL,
	`updated_at` integer DEFAULT (strftime('%s','now')) NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_provider_services`("id", "name", "base_url", "api_key", "api_mode", "is_official", "is_enabled", "created_at", "updated_at") SELECT "id", "name", "base_url", IFNULL("api_key", '') as "api_key", "api_mode", "is_official", "is_enabled", "created_at", "updated_at" FROM `provider_services`;--> statement-breakpoint
DROP TABLE `provider_services`;--> statement-breakpoint
ALTER TABLE `__new_provider_services` RENAME TO `provider_services`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
ALTER TABLE `provider_service_models` ADD `name` text NOT NULL DEFAULT '';
