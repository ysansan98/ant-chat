ALTER TABLE `conversations` ADD `workspace_path` text;--> statement-breakpoint
CREATE INDEX `idx_conversations_workspace_path_updated_at` ON `conversations` (`workspace_path`,`updated_at`);--> statement-breakpoint
CREATE INDEX `idx_conversations_updated_at` ON `conversations` (`updated_at`);
