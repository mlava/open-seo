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

// Private, project-scoped evidence collected by asking tracked prompts against
// AI assistants with their native web search on. API credentials are instance
// secrets; prompts and answer evidence live here.
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
    // JSON array of provider slugs — the project default. A prompt may narrow
    // it (see prompts.providers) but never widen it beyond configured keys.
    providers: text("providers").notNull().default('["openai"]'),
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
    // JSON array of provider slugs, or null to inherit the project default.
    providers: text("providers"),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (table) => [
    index("ai_citation_tracking_prompts_project_idx").on(table.projectId),
  ],
);

export const aiCitationTrackingTags = sqliteTable(
  "ai_citation_tracking_tags",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    // Palette key (e.g. "blue", "rose"). Null = derive a stable color from the
    // tag id at render time. See src/shared/tag-colors.ts.
    color: text("color"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (table) => [
    uniqueIndex("ai_citation_tracking_tags_project_normalized_idx").on(
      table.projectId,
      table.normalizedName,
    ),
  ],
);

export const aiCitationTrackingPromptTags = sqliteTable(
  "ai_citation_tracking_prompt_tags",
  {
    promptId: text("prompt_id")
      .notNull()
      .references(() => aiCitationTrackingPrompts.id, { onDelete: "cascade" }),
    tagId: text("tag_id")
      .notNull()
      .references(() => aiCitationTrackingTags.id, { onDelete: "cascade" }),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (table) => [
    uniqueIndex("ai_citation_tracking_prompt_tags_unique_idx").on(
      table.promptId,
      table.tagId,
    ),
    // No standalone index on promptId — the unique index above has it as its
    // leftmost column, so it already serves promptId lookups.
    index("ai_citation_tracking_prompt_tags_tag_idx").on(table.tagId),
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
    // prompt x provider pairs — the real unit of work and of API spend.
    taskCount: integer("task_count").notNull().default(0),
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
    // Defaulted so the column can be added to an existing table (SQLite
    // rejects a NOT NULL add without one) — every pre-fan-out row was OpenAI.
    provider: text("provider").notNull().default("openai"),
    model: text("model").notNull(),
    answerText: text("answer_text"),
    // True when a brand alias appears in the answer prose, whether or not the
    // assistant also cited a tracked domain.
    brandMentioned: integer("brand_mentioned", { mode: "boolean" })
      .notNull()
      .default(false),
    errorMessage: text("error_message"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (table) => [
    index("ai_citation_tracking_responses_run_idx").on(table.runId),
    index("ai_citation_tracking_responses_project_created_idx").on(
      table.projectId,
      table.createdAt,
    ),
    // One row per (run, prompt, provider). A Workflow step that retries after a
    // partial pass re-inserts nothing, so a retry cannot double-charge the
    // operator's API budget or duplicate evidence.
    uniqueIndex("ai_citation_tracking_responses_task_idx").on(
      table.runId,
      table.promptId,
      table.provider,
    ),
  ],
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
    index("ai_citation_tracking_citations_project_domain_idx").on(
      table.projectId,
      table.domain,
    ),
  ],
);
