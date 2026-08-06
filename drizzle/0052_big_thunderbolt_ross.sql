CREATE TABLE `ai_citation_tracking_prompt_tags` (
	`prompt_id` text NOT NULL,
	`tag_id` text NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`prompt_id`) REFERENCES `ai_citation_tracking_prompts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `ai_citation_tracking_tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_citation_tracking_prompt_tags_unique_idx` ON `ai_citation_tracking_prompt_tags` (`prompt_id`,`tag_id`);--> statement-breakpoint
CREATE INDEX `ai_citation_tracking_prompt_tags_tag_idx` ON `ai_citation_tracking_prompt_tags` (`tag_id`);--> statement-breakpoint
CREATE TABLE `ai_citation_tracking_tags` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`normalized_name` text NOT NULL,
	`color` text,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_citation_tracking_tags_project_normalized_idx` ON `ai_citation_tracking_tags` (`project_id`,`normalized_name`);--> statement-breakpoint
ALTER TABLE `ai_citation_tracking_configs` ADD `providers` text DEFAULT '["openai"]' NOT NULL;--> statement-breakpoint
ALTER TABLE `ai_citation_tracking_prompts` ADD `providers` text;--> statement-breakpoint
ALTER TABLE `ai_citation_tracking_responses` ADD `provider` text DEFAULT 'openai' NOT NULL;--> statement-breakpoint
ALTER TABLE `ai_citation_tracking_responses` ADD `brand_mentioned` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX `ai_citation_tracking_responses_project_created_idx` ON `ai_citation_tracking_responses` (`project_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `ai_citation_tracking_responses_task_idx` ON `ai_citation_tracking_responses` (`run_id`,`prompt_id`,`provider`);--> statement-breakpoint
ALTER TABLE `ai_citation_tracking_runs` ADD `task_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `ai_citation_tracking_citations_project_domain_idx` ON `ai_citation_tracking_citations` (`project_id`,`domain`);