ALTER TABLE `provider_service_models` RENAME TO `service_provider_models`;--> statement-breakpoint
ALTER TABLE `provider_services` RENAME TO `service_provider`;--> statement-breakpoint
ALTER TABLE `service_provider_models` RENAME COLUMN "provider_service_id" TO "service_provider_id";--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_service_provider_models` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`model` text NOT NULL,
	`is_builtin` integer DEFAULT false NOT NULL,
	`is_enabled` integer DEFAULT true NOT NULL,
	`model_features` text,
	`service_provider_id` text NOT NULL,
	`created_at` integer DEFAULT (strftime('%s','now')) NOT NULL,
	FOREIGN KEY (`service_provider_id`) REFERENCES `service_provider`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_service_provider_models`("id", "name", "model", "is_builtin", "is_enabled", "model_features", "service_provider_id", "created_at") SELECT "id", "name", "model", "is_builtin", "is_enabled", "model_features", "service_provider_id", "created_at" FROM `service_provider_models`;--> statement-breakpoint
DROP TABLE `service_provider_models`;--> statement-breakpoint
ALTER TABLE `__new_service_provider_models` RENAME TO `service_provider_models`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `service_provider_models_model_service_provider_id_unique` ON `service_provider_models` (`model`,`service_provider_id`);