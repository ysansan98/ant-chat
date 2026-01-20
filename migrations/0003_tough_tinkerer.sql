CREATE TABLE `provider_service_models` (
	`id` text PRIMARY KEY NOT NULL,
	`model` text NOT NULL,
	`is_builtin` integer DEFAULT 0 NOT NULL,
	`is_enabled` integer DEFAULT 1 NOT NULL,
	`model_features` text,
	`provider_service_id` text NOT NULL,
	`created_at` integer DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`provider_service_id`) REFERENCES `provider_services`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `provider_service_models_model_provider_service_id_unique` ON `provider_service_models` (`model`,`provider_service_id`);--> statement-breakpoint
CREATE TABLE `provider_services` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`base_url` text NOT NULL,
	`api_key` text,
	`api_mode` text NOT NULL,
	`is_official` integer DEFAULT 0 NOT NULL,
	`is_enabled` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` integer DEFAULT (CURRENT_TIMESTAMP) NOT NULL
);
