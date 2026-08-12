CREATE TABLE `apikey` (
	`id` text PRIMARY KEY NOT NULL,
	`config_id` text DEFAULT 'default' NOT NULL,
	`name` text,
	`start` text,
	`prefix` text,
	`key` text NOT NULL,
	`reference_id` text NOT NULL,
	`refill_interval` integer,
	`refill_amount` integer,
	`last_refill_at` integer,
	`enabled` integer DEFAULT true,
	`rate_limit_enabled` integer DEFAULT true,
	`rate_limit_time_window` integer DEFAULT 60000,
	`rate_limit_max` integer DEFAULT 120,
	`request_count` integer DEFAULT 0,
	`remaining` integer,
	`last_request` integer,
	`expires_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`permissions` text,
	`metadata` text
);
--> statement-breakpoint
CREATE INDEX `apikey_configId_idx` ON `apikey` (`config_id`);--> statement-breakpoint
CREATE INDEX `apikey_referenceId_idx` ON `apikey` (`reference_id`);--> statement-breakpoint
CREATE INDEX `apikey_key_idx` ON `apikey` (`key`);--> statement-breakpoint
CREATE TABLE `ga4_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`property_id` text NOT NULL,
	`property_display_name` text NOT NULL,
	`property_time_zone` text NOT NULL,
	`property_currency_code` text NOT NULL,
	`connected_by_user_id` text NOT NULL,
	`ga4_account_id` text NOT NULL,
	`connected_account_email` text,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ga4_connections_project_idx` ON `ga4_connections` (`project_id`);--> statement-breakpoint
CREATE INDEX `ga4_connections_organization_idx` ON `ga4_connections` (`organization_id`);--> statement-breakpoint
CREATE INDEX `ga4_connections_connector_idx` ON `ga4_connections` (`connected_by_user_id`,`ga4_account_id`);--> statement-breakpoint
ALTER TABLE `project_activation_state` ADD `ga4_card_dismissed_at` text;--> statement-breakpoint
ALTER TABLE `audits` ADD `error_code` text;--> statement-breakpoint
ALTER TABLE `audits` ADD `error_detail` text;--> statement-breakpoint
ALTER TABLE `audits` ADD `failed_phase` text;