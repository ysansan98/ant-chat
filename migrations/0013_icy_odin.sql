PRAGMA foreign_keys=OFF;--> statement-breakpoint
UPDATE service_provider_models SET service_provider_id = 'google' WHERE service_provider_id = 'gemini';--> statement-breakpoint
UPDATE service_provider SET id = 'google' WHERE id = 'gemini';--> statement-breakpoint
UPDATE service_provider SET name = 'Google' WHERE id = 'google';--> statement-breakpoint
UPDATE service_provider SET api_mode = 'google' WHERE api_mode = 'gemini';--> statement-breakpoint
PRAGMA foreign_keys=ON;
