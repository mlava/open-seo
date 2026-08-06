CREATE TABLE "ai_citation_tracking_citations" (
	"id" text PRIMARY KEY NOT NULL,
	"response_id" text NOT NULL,
	"project_id" text NOT NULL,
	"url" text NOT NULL,
	"domain" text NOT NULL,
	"title" text,
	"citation_order" integer NOT NULL,
	"is_tracked_domain" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_citation_tracking_configs" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"brand_aliases" text DEFAULT '[]' NOT NULL,
	"schedule_enabled" boolean DEFAULT true NOT NULL,
	"next_run_at" text,
	"created_by_user_id" text NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"updated_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_citation_tracking_prompts" (
	"id" text PRIMARY KEY NOT NULL,
	"config_id" text NOT NULL,
	"project_id" text NOT NULL,
	"label" text NOT NULL,
	"prompt" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_citation_tracking_responses" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"prompt_id" text NOT NULL,
	"project_id" text NOT NULL,
	"model" text NOT NULL,
	"answer_text" text,
	"raw_response" text,
	"error_message" text,
	"input_tokens" integer,
	"output_tokens" integer,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_citation_tracking_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"config_id" text NOT NULL,
	"project_id" text NOT NULL,
	"trigger" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"prompt_count" integer DEFAULT 0 NOT NULL,
	"succeeded_count" integer DEFAULT 0 NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"started_at" text,
	"completed_at" text,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_citation_tracking_citations" ADD CONSTRAINT "ai_citation_tracking_citations_response_id_ai_citation_tracking_responses_id_fk" FOREIGN KEY ("response_id") REFERENCES "public"."ai_citation_tracking_responses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_citation_tracking_citations" ADD CONSTRAINT "ai_citation_tracking_citations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_citation_tracking_configs" ADD CONSTRAINT "ai_citation_tracking_configs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_citation_tracking_configs" ADD CONSTRAINT "ai_citation_tracking_configs_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_citation_tracking_prompts" ADD CONSTRAINT "ai_citation_tracking_prompts_config_id_ai_citation_tracking_configs_id_fk" FOREIGN KEY ("config_id") REFERENCES "public"."ai_citation_tracking_configs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_citation_tracking_prompts" ADD CONSTRAINT "ai_citation_tracking_prompts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_citation_tracking_responses" ADD CONSTRAINT "ai_citation_tracking_responses_run_id_ai_citation_tracking_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."ai_citation_tracking_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_citation_tracking_responses" ADD CONSTRAINT "ai_citation_tracking_responses_prompt_id_ai_citation_tracking_prompts_id_fk" FOREIGN KEY ("prompt_id") REFERENCES "public"."ai_citation_tracking_prompts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_citation_tracking_responses" ADD CONSTRAINT "ai_citation_tracking_responses_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_citation_tracking_runs" ADD CONSTRAINT "ai_citation_tracking_runs_config_id_ai_citation_tracking_configs_id_fk" FOREIGN KEY ("config_id") REFERENCES "public"."ai_citation_tracking_configs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_citation_tracking_runs" ADD CONSTRAINT "ai_citation_tracking_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_citation_tracking_citations_response_idx" ON "ai_citation_tracking_citations" USING btree ("response_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_citation_tracking_configs_project_idx" ON "ai_citation_tracking_configs" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "ai_citation_tracking_configs_due_idx" ON "ai_citation_tracking_configs" USING btree ("next_run_at");--> statement-breakpoint
CREATE INDEX "ai_citation_tracking_prompts_project_idx" ON "ai_citation_tracking_prompts" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "ai_citation_tracking_responses_run_idx" ON "ai_citation_tracking_responses" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "ai_citation_tracking_runs_project_created_idx" ON "ai_citation_tracking_runs" USING btree ("project_id","created_at");