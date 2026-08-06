CREATE TABLE "ai_citation_tracking_prompt_tags" (
	"prompt_id" text NOT NULL,
	"tag_id" text NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_citation_tracking_tags" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"color" text,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_citation_tracking_configs" ADD COLUMN "providers" text DEFAULT '["openai"]' NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_citation_tracking_prompts" ADD COLUMN "providers" text;--> statement-breakpoint
ALTER TABLE "ai_citation_tracking_responses" ADD COLUMN "provider" text DEFAULT 'openai' NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_citation_tracking_responses" ADD COLUMN "brand_mentioned" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_citation_tracking_runs" ADD COLUMN "task_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_citation_tracking_prompt_tags" ADD CONSTRAINT "ai_citation_tracking_prompt_tags_prompt_id_ai_citation_tracking_prompts_id_fk" FOREIGN KEY ("prompt_id") REFERENCES "public"."ai_citation_tracking_prompts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_citation_tracking_prompt_tags" ADD CONSTRAINT "ai_citation_tracking_prompt_tags_tag_id_ai_citation_tracking_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."ai_citation_tracking_tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_citation_tracking_tags" ADD CONSTRAINT "ai_citation_tracking_tags_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_citation_tracking_prompt_tags_unique_idx" ON "ai_citation_tracking_prompt_tags" USING btree ("prompt_id","tag_id");--> statement-breakpoint
CREATE INDEX "ai_citation_tracking_prompt_tags_tag_idx" ON "ai_citation_tracking_prompt_tags" USING btree ("tag_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_citation_tracking_tags_project_normalized_idx" ON "ai_citation_tracking_tags" USING btree ("project_id","normalized_name");--> statement-breakpoint
CREATE INDEX "ai_citation_tracking_citations_project_domain_idx" ON "ai_citation_tracking_citations" USING btree ("project_id","domain");--> statement-breakpoint
CREATE INDEX "ai_citation_tracking_responses_project_created_idx" ON "ai_citation_tracking_responses" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_citation_tracking_responses_task_idx" ON "ai_citation_tracking_responses" USING btree ("run_id","prompt_id","provider");