import {
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
  boolean,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organization } from "./better-auth-schema";
import { projects } from "./app.schema";

const isoNow = sql`to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

export const aiCitationTrackingConfigs = pgTable(
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
    providers: text("providers").notNull().default('["openai"]'),
    scheduleEnabled: boolean("schedule_enabled").notNull().default(true),
    nextRunAt: text("next_run_at"),
    createdByUserId: text("created_by_user_id").notNull(),
    createdAt: text("created_at").notNull().default(isoNow),
    updatedAt: text("updated_at").notNull().default(isoNow),
  },
  (t) => [
    uniqueIndex("ai_citation_tracking_configs_project_idx").on(t.projectId),
    index("ai_citation_tracking_configs_due_idx").on(t.nextRunAt),
  ],
);

export const aiCitationTrackingPrompts = pgTable(
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
    providers: text("providers"),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: text("created_at").notNull().default(isoNow),
  },
  (t) => [index("ai_citation_tracking_prompts_project_idx").on(t.projectId)],
);

export const aiCitationTrackingTags = pgTable(
  "ai_citation_tracking_tags",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    color: text("color"),
    createdAt: text("created_at").notNull().default(isoNow),
  },
  (t) => [
    uniqueIndex("ai_citation_tracking_tags_project_normalized_idx").on(
      t.projectId,
      t.normalizedName,
    ),
  ],
);

export const aiCitationTrackingPromptTags = pgTable(
  "ai_citation_tracking_prompt_tags",
  {
    promptId: text("prompt_id")
      .notNull()
      .references(() => aiCitationTrackingPrompts.id, { onDelete: "cascade" }),
    tagId: text("tag_id")
      .notNull()
      .references(() => aiCitationTrackingTags.id, { onDelete: "cascade" }),
    createdAt: text("created_at").notNull().default(isoNow),
  },
  (t) => [
    uniqueIndex("ai_citation_tracking_prompt_tags_unique_idx").on(
      t.promptId,
      t.tagId,
    ),
    index("ai_citation_tracking_prompt_tags_tag_idx").on(t.tagId),
  ],
);

export const aiCitationTrackingRuns = pgTable(
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
    taskCount: integer("task_count").notNull().default(0),
    succeededCount: integer("succeeded_count").notNull().default(0),
    failedCount: integer("failed_count").notNull().default(0),
    errorMessage: text("error_message"),
    startedAt: text("started_at"),
    completedAt: text("completed_at"),
    createdAt: text("created_at").notNull().default(isoNow),
  },
  (t) => [
    index("ai_citation_tracking_runs_project_created_idx").on(
      t.projectId,
      t.createdAt,
    ),
  ],
);

export const aiCitationTrackingResponses = pgTable(
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
    provider: text("provider").notNull().default("openai"),
    model: text("model").notNull(),
    answerText: text("answer_text"),
    brandMentioned: boolean("brand_mentioned").notNull().default(false),
    errorMessage: text("error_message"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    createdAt: text("created_at").notNull().default(isoNow),
  },
  (t) => [
    index("ai_citation_tracking_responses_run_idx").on(t.runId),
    index("ai_citation_tracking_responses_project_created_idx").on(
      t.projectId,
      t.createdAt,
    ),
    uniqueIndex("ai_citation_tracking_responses_task_idx").on(
      t.runId,
      t.promptId,
      t.provider,
    ),
  ],
);

export const aiCitationTrackingCitations = pgTable(
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
    isTrackedDomain: boolean("is_tracked_domain").notNull().default(false),
  },
  (t) => [
    index("ai_citation_tracking_citations_response_idx").on(t.responseId),
    index("ai_citation_tracking_citations_project_domain_idx").on(
      t.projectId,
      t.domain,
    ),
  ],
);
