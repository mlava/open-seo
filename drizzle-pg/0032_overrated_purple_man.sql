CREATE TABLE "apikey" (
	"id" text PRIMARY KEY NOT NULL,
	"config_id" text DEFAULT 'default' NOT NULL,
	"name" text,
	"start" text,
	"prefix" text,
	"key" text NOT NULL,
	"reference_id" text NOT NULL,
	"refill_interval" integer,
	"refill_amount" integer,
	"last_refill_at" timestamp with time zone,
	"enabled" boolean DEFAULT true,
	"rate_limit_enabled" boolean DEFAULT true,
	"rate_limit_time_window" integer DEFAULT 60000,
	"rate_limit_max" integer DEFAULT 120,
	"request_count" integer DEFAULT 0,
	"remaining" integer,
	"last_request" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"permissions" text,
	"metadata" text
);
--> statement-breakpoint
CREATE TABLE "ga4_connections" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"property_id" text NOT NULL,
	"property_display_name" text NOT NULL,
	"property_time_zone" text NOT NULL,
	"property_currency_code" text NOT NULL,
	"connected_by_user_id" text NOT NULL,
	"ga4_account_id" text NOT NULL,
	"connected_account_email" text,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"updated_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
ALTER TABLE "backlink_snapshots" ALTER COLUMN "backlinks" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "backlink_snapshots" ALTER COLUMN "referring_domains" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "backlink_snapshots" ALTER COLUMN "broken_backlinks" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "backlink_snapshots" ALTER COLUMN "new_backlinks" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "backlink_snapshots" ALTER COLUMN "lost_backlinks" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "backlink_snapshots" ALTER COLUMN "new_referring_domains" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "backlink_snapshots" ALTER COLUMN "lost_referring_domains" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "project_activation_state" ADD COLUMN "ga4_card_dismissed_at" text;--> statement-breakpoint
ALTER TABLE "audits" ADD COLUMN "error_code" text;--> statement-breakpoint
ALTER TABLE "audits" ADD COLUMN "error_detail" text;--> statement-breakpoint
ALTER TABLE "audits" ADD COLUMN "failed_phase" text;--> statement-breakpoint
ALTER TABLE "ga4_connections" ADD CONSTRAINT "ga4_connections_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ga4_connections" ADD CONSTRAINT "ga4_connections_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "apikey_configId_idx" ON "apikey" USING btree ("config_id");--> statement-breakpoint
CREATE INDEX "apikey_referenceId_idx" ON "apikey" USING btree ("reference_id");--> statement-breakpoint
CREATE INDEX "apikey_key_idx" ON "apikey" USING btree ("key");--> statement-breakpoint
CREATE UNIQUE INDEX "ga4_connections_project_idx" ON "ga4_connections" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "ga4_connections_organization_idx" ON "ga4_connections" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "ga4_connections_connector_idx" ON "ga4_connections" USING btree ("connected_by_user_id","ga4_account_id");