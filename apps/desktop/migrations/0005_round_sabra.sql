PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_provider_service_models` (
	`id` text PRIMARY KEY NOT NULL,
	`model` text NOT NULL,
	`is_builtin` integer DEFAULT false NOT NULL,
	`is_enabled` integer DEFAULT true NOT NULL,
	`model_features` text,
	`provider_service_id` text NOT NULL,
	`created_at` integer DEFAULT (strftime('%s','now')) NOT NULL,
	FOREIGN KEY (`provider_service_id`) REFERENCES `provider_services`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_provider_service_models`("id", "model", "is_builtin", "is_enabled", "model_features", "provider_service_id", "created_at") SELECT "id", "model", "is_builtin", "is_enabled", "model_features", "provider_service_id", "created_at" FROM `provider_service_models`;--> statement-breakpoint
DROP TABLE `provider_service_models`;--> statement-breakpoint
ALTER TABLE `__new_provider_service_models` RENAME TO `provider_service_models`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `provider_service_models_model_provider_service_id_unique` ON `provider_service_models` (`model`,`provider_service_id`);