CREATE TABLE `x402_wallets` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`wallet_address` text NOT NULL,
	`connected_by_user_id` text NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `x402_wallets_project_idx` ON `x402_wallets` (`project_id`);--> statement-breakpoint
CREATE INDEX `x402_wallets_organization_idx` ON `x402_wallets` (`organization_id`);