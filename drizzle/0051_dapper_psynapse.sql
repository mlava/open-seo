CREATE TABLE `ai_citation_tracking_citations` (
	`id` text PRIMARY KEY NOT NULL,
	`response_id` text NOT NULL,
	`project_id` text NOT NULL,
	`url` text NOT NULL,
	`domain` text NOT NULL,
	`title` text,
	`citation_order` integer NOT NULL,
	`is_tracked_domain` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`response_id`) REFERENCES `ai_citation_tracking_responses`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ai_citation_tracking_citations_response_idx` ON `ai_citation_tracking_citations` (`response_id`);--> statement-breakpoint
CREATE TABLE `ai_citation_tracking_configs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`brand_aliases` text DEFAULT '[]' NOT NULL,
	`schedule_enabled` integer DEFAULT true NOT NULL,
	`next_run_at` text,
	`created_by_user_id` text NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_citation_tracking_configs_project_idx` ON `ai_citation_tracking_configs` (`project_id`);--> statement-breakpoint
CREATE INDEX `ai_citation_tracking_configs_due_idx` ON `ai_citation_tracking_configs` (`next_run_at`);--> statement-breakpoint
CREATE TABLE `ai_citation_tracking_prompts` (
	`id` text PRIMARY KEY NOT NULL,
	`config_id` text NOT NULL,
	`project_id` text NOT NULL,
	`label` text NOT NULL,
	`prompt` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`config_id`) REFERENCES `ai_citation_tracking_configs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ai_citation_tracking_prompts_project_idx` ON `ai_citation_tracking_prompts` (`project_id`);--> statement-breakpoint
CREATE TABLE `ai_citation_tracking_responses` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`prompt_id` text NOT NULL,
	`project_id` text NOT NULL,
	`model` text NOT NULL,
	`answer_text` text,
	`raw_response` text,
	`error_message` text,
	`input_tokens` integer,
	`output_tokens` integer,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `ai_citation_tracking_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`prompt_id`) REFERENCES `ai_citation_tracking_prompts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ai_citation_tracking_responses_run_idx` ON `ai_citation_tracking_responses` (`run_id`);--> statement-breakpoint
CREATE TABLE `ai_citation_tracking_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`config_id` text NOT NULL,
	`project_id` text NOT NULL,
	`trigger` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`prompt_count` integer DEFAULT 0 NOT NULL,
	`succeeded_count` integer DEFAULT 0 NOT NULL,
	`failed_count` integer DEFAULT 0 NOT NULL,
	`error_message` text,
	`started_at` text,
	`completed_at` text,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`config_id`) REFERENCES `ai_citation_tracking_configs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ai_citation_tracking_runs_project_created_idx` ON `ai_citation_tracking_runs` (`project_id`,`created_at`);