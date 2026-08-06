import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { organization } from "./better-auth-schema";
import { projects } from "./app.schema";

// Private, project-scoped evidence collected from OpenAI web-search responses.
// API credentials are instance secrets; prompts and answer evidence live here.
export const aiCitationTrackingConfigs = sqliteTable(
  "ai_citation_tracking_configs",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    brandAliases: text("brand_aliases").notNull().default("[]"),
    scheduleEnabled: integer("schedule_enabled", { mode: "boolean" })
      .notNull()
      .default(true),
    nextRunAt: text("next_run_at"),
    createdByUserId: text("created_by_user_id").notNull(),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (table) => [
    uniqueIndex("ai_citation_tracking_configs_project_idx").on(table.projectId),
    index("ai_citation_tracking_configs_due_idx").on(table.nextRunAt),
  ],
);

export const aiCitationTrackingPrompts = sqliteTable(
  "ai_citation_tracking_prompts",
  {
    id: text("id").primaryKey(),
    configId: text("config_id")
      .notNull()
      .references(() => aiCitationTrackingConfigs.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    prompt: text("prompt").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (table) => [
    index("ai_citation_tracking_prompts_project_idx").on(table.projectId),
  ],
);

export const aiCitationTrackingRuns = sqliteTable(
  "ai_citation_tracking_runs",
  {
    id: text("id").primaryKey(),
    configId: text("config_id")
      .notNull()
      .references(() => aiCitationTrackingConfigs.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    trigger: text("trigger", { enum: ["manual", "scheduled"] }).notNull(),
    status: text("status", {
      enum: ["pending", "running", "completed", "failed"],
    })
      .notNull()
      .default("pending"),
    promptCount: integer("prompt_count").notNull().default(0),
    succeededCount: integer("succeeded_count").notNull().default(0),
    failedCount: integer("failed_count").notNull().default(0),
    errorMessage: text("error_message"),
    startedAt: text("started_at"),
    completedAt: text("completed_at"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (table) => [
    index("ai_citation_tracking_runs_project_created_idx").on(
      table.projectId,
      table.createdAt,
    ),
  ],
);

export const aiCitationTrackingResponses = sqliteTable(
  "ai_citation_tracking_responses",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => aiCitationTrackingRuns.id, { onDelete: "cascade" }),
    promptId: text("prompt_id")
      .notNull()
      .references(() => aiCitationTrackingPrompts.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    model: text("model").notNull(),
    answerText: text("answer_text"),
    rawResponse: text("raw_response"),
    errorMessage: text("error_message"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (table) => [index("ai_citation_tracking_responses_run_idx").on(table.runId)],
);

export const aiCitationTrackingCitations = sqliteTable(
  "ai_citation_tracking_citations",
  {
    id: text("id").primaryKey(),
    responseId: text("response_id")
      .notNull()
      .references(() => aiCitationTrackingResponses.id, {
        onDelete: "cascade",
      }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    domain: text("domain").notNull(),
    title: text("title"),
    citationOrder: integer("citation_order").notNull(),
    isTrackedDomain: integer("is_tracked_domain", { mode: "boolean" })
      .notNull()
      .default(false),
  },
  (table) => [
    index("ai_citation_tracking_citations_response_idx").on(table.responseId),
  ],
);
