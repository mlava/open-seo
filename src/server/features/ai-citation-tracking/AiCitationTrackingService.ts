import { and, desc, eq, isNull, lte, or } from "drizzle-orm";
import { db } from "@/db";
import {
  aiCitationTrackingCitations,
  aiCitationTrackingConfigs,
  aiCitationTrackingPrompts,
  aiCitationTrackingResponses,
  aiCitationTrackingRuns,
} from "@/db/schema";
import { AppError } from "@/server/lib/errors";
import {
  callOpenAiForCitationTracking,
  hasOpenAiCitationTrackingKey,
  type OpenAiCitationResult,
} from "./openaiCitationClient";

const MAX_PROMPTS_PER_PROJECT = 50;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function parseAliases(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function normalizeAliases(aliases: string[]): string[] {
  return [...new Set(aliases.map((alias) => alias.trim()).filter(Boolean))];
}

function nextWeeklyRun(now = new Date()): string {
  return new Date(now.getTime() + WEEK_MS).toISOString();
}

function safeDomain(value: string): string | null {
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

async function getOverview(projectId: string) {
  const config =
    (
      await db
        .select()
        .from(aiCitationTrackingConfigs)
        .where(eq(aiCitationTrackingConfigs.projectId, projectId))
        .limit(1)
    )[0] ?? null;
  const prompts = await db
    .select()
    .from(aiCitationTrackingPrompts)
    .where(eq(aiCitationTrackingPrompts.projectId, projectId))
    .orderBy(desc(aiCitationTrackingPrompts.createdAt));
  const runs = await db
    .select()
    .from(aiCitationTrackingRuns)
    .where(eq(aiCitationTrackingRuns.projectId, projectId))
    .orderBy(desc(aiCitationTrackingRuns.createdAt))
    .limit(20);
  const recentResponseRows = await db
    .select()
    .from(aiCitationTrackingResponses)
    .where(eq(aiCitationTrackingResponses.projectId, projectId))
    .orderBy(desc(aiCitationTrackingResponses.createdAt))
    .limit(50);
  const responseIds = recentResponseRows.map((row) => row.id);
  const citations =
    responseIds.length === 0
      ? []
      : await db
          .select()
          .from(aiCitationTrackingCitations)
          .where(eq(aiCitationTrackingCitations.projectId, projectId))
          .limit(200);
  return {
    configured: await hasOpenAiCitationTrackingKey(),
    config: config
      ? { ...config, brandAliases: parseAliases(config.brandAliases) }
      : null,
    prompts,
    runs,
    responses: recentResponseRows,
    citations,
  };
}

async function saveConfig(input: {
  projectId: string;
  organizationId: string;
  userId: string;
  aliases: string[];
  scheduleEnabled: boolean;
}) {
  const values = {
    brandAliases: JSON.stringify(normalizeAliases(input.aliases)),
    scheduleEnabled: input.scheduleEnabled,
    nextRunAt: input.scheduleEnabled ? nextWeeklyRun() : null,
    updatedAt: new Date().toISOString(),
  };
  const existing = (
    await db
      .select({ id: aiCitationTrackingConfigs.id })
      .from(aiCitationTrackingConfigs)
      .where(eq(aiCitationTrackingConfigs.projectId, input.projectId))
      .limit(1)
  )[0];
  if (existing) {
    await db
      .update(aiCitationTrackingConfigs)
      .set(values)
      .where(eq(aiCitationTrackingConfigs.id, existing.id));
  } else {
    await db.insert(aiCitationTrackingConfigs).values({
      id: crypto.randomUUID(),
      projectId: input.projectId,
      organizationId: input.organizationId,
      createdByUserId: input.userId,
      ...values,
    });
  }
}

async function addPrompt(input: {
  projectId: string;
  label: string;
  prompt: string;
}) {
  const config = (
    await db
      .select()
      .from(aiCitationTrackingConfigs)
      .where(eq(aiCitationTrackingConfigs.projectId, input.projectId))
      .limit(1)
  )[0];
  if (!config)
    throw new AppError(
      "VALIDATION_ERROR",
      "Save your tracker settings before adding prompts",
    );
  const count = await db
    .select({ id: aiCitationTrackingPrompts.id })
    .from(aiCitationTrackingPrompts)
    .where(eq(aiCitationTrackingPrompts.projectId, input.projectId));
  if (count.length >= MAX_PROMPTS_PER_PROJECT)
    throw new AppError(
      "VALIDATION_ERROR",
      `You can track up to ${MAX_PROMPTS_PER_PROJECT} prompts per project`,
    );
  await db.insert(aiCitationTrackingPrompts).values({
    id: crypto.randomUUID(),
    configId: config.id,
    projectId: input.projectId,
    label: input.label.trim(),
    prompt: input.prompt.trim(),
  });
}

async function removePrompt(projectId: string, promptId: string) {
  await db
    .delete(aiCitationTrackingPrompts)
    .where(
      and(
        eq(aiCitationTrackingPrompts.id, promptId),
        eq(aiCitationTrackingPrompts.projectId, projectId),
      ),
    );
}

async function createRun(projectId: string, trigger: "manual" | "scheduled") {
  const config = (
    await db
      .select()
      .from(aiCitationTrackingConfigs)
      .where(eq(aiCitationTrackingConfigs.projectId, projectId))
      .limit(1)
  )[0];
  if (!config)
    throw new AppError(
      "VALIDATION_ERROR",
      "Configure the tracker before running it",
    );
  const prompts = await db
    .select({ id: aiCitationTrackingPrompts.id })
    .from(aiCitationTrackingPrompts)
    .where(
      and(
        eq(aiCitationTrackingPrompts.projectId, projectId),
        eq(aiCitationTrackingPrompts.enabled, true),
      ),
    );
  if (prompts.length === 0)
    throw new AppError(
      "VALIDATION_ERROR",
      "Add at least one enabled prompt before running the tracker",
    );
  const id = crypto.randomUUID();
  await db.insert(aiCitationTrackingRuns).values({
    id,
    configId: config.id,
    projectId,
    trigger,
    promptCount: prompts.length,
  });
  return id;
}

async function runById(runId: string) {
  const run = (
    await db
      .select()
      .from(aiCitationTrackingRuns)
      .where(eq(aiCitationTrackingRuns.id, runId))
      .limit(1)
  )[0];
  if (!run) throw new Error("Citation tracking run was not found");
  const config = (
    await db
      .select()
      .from(aiCitationTrackingConfigs)
      .where(eq(aiCitationTrackingConfigs.id, run.configId))
      .limit(1)
  )[0];
  if (!config) throw new Error("Citation tracking configuration was not found");
  const prompts = await db
    .select()
    .from(aiCitationTrackingPrompts)
    .where(
      and(
        eq(aiCitationTrackingPrompts.configId, config.id),
        eq(aiCitationTrackingPrompts.enabled, true),
      ),
    );
  await db
    .update(aiCitationTrackingRuns)
    .set({ status: "running", startedAt: new Date().toISOString() })
    .where(eq(aiCitationTrackingRuns.id, runId));
  let succeeded = 0;
  let failed = 0;
  const trackedDomains = new Set(
    parseAliases(config.brandAliases)
      .map(safeDomain)
      .filter((domain): domain is string => Boolean(domain)),
  );
  for (const prompt of prompts) {
    try {
      const result: OpenAiCitationResult = await callOpenAiForCitationTracking(
        prompt.prompt,
      );
      const responseId = crypto.randomUUID();
      await db.insert(aiCitationTrackingResponses).values({
        id: responseId,
        runId,
        promptId: prompt.id,
        projectId: run.projectId,
        model: result.model,
        answerText: result.answerText,
        rawResponse: result.rawResponse,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
      });
      if (result.citations.length)
        await db.insert(aiCitationTrackingCitations).values(
          result.citations.flatMap((citation, citationOrder) => {
            const domain = safeDomain(citation.url);
            return domain
              ? [
                  {
                    id: crypto.randomUUID(),
                    responseId,
                    projectId: run.projectId,
                    url: citation.url,
                    domain,
                    title: citation.title,
                    citationOrder,
                    isTrackedDomain: trackedDomains.has(domain),
                  },
                ]
              : [];
          }),
        );
      succeeded += 1;
    } catch (error) {
      await db.insert(aiCitationTrackingResponses).values({
        id: crypto.randomUUID(),
        runId,
        promptId: prompt.id,
        projectId: run.projectId,
        model: "unknown",
        errorMessage:
          error instanceof Error ? error.message : "OpenAI collection failed",
      });
      failed += 1;
    }
  }
  const completedAt = new Date().toISOString();
  await db
    .update(aiCitationTrackingRuns)
    .set({
      status: failed === prompts.length ? "failed" : "completed",
      succeededCount: succeeded,
      failedCount: failed,
      completedAt,
      errorMessage: failed
        ? `${failed} prompt${failed === 1 ? "" : "s"} failed`
        : null,
    })
    .where(eq(aiCitationTrackingRuns.id, runId));
  return { succeeded, failed };
}

async function listDueConfigs(nowIso: string) {
  return db
    .select()
    .from(aiCitationTrackingConfigs)
    .where(
      and(
        eq(aiCitationTrackingConfigs.scheduleEnabled, true),
        or(
          isNull(aiCitationTrackingConfigs.nextRunAt),
          lte(aiCitationTrackingConfigs.nextRunAt, nowIso),
        ),
      ),
    );
}

async function advanceSchedule(id: string) {
  await db
    .update(aiCitationTrackingConfigs)
    .set({ nextRunAt: nextWeeklyRun(), updatedAt: new Date().toISOString() })
    .where(eq(aiCitationTrackingConfigs.id, id));
}

export const AiCitationTrackingService = {
  getOverview,
  saveConfig,
  addPrompt,
  removePrompt,
  createRun,
  runById,
  listDueConfigs,
  advanceSchedule,
};
