import { and, desc, eq, isNull, lte, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  aiCitationTrackingCitations,
  aiCitationTrackingConfigs,
  aiCitationTrackingPrompts,
  aiCitationTrackingResponses,
  aiCitationTrackingRuns,
  aiCitationTrackingTags,
} from "@/db/schema";
import { AppError } from "@/server/lib/errors";
import {
  CITATION_PROVIDERS,
  parseCitationProviders,
  serializeCitationProviders,
  type CitationProvider,
} from "@/shared/ai-citation-providers";
import { getConfiguredCitationProviders } from "./citationClient";
import { listPromptTags, setPromptTags } from "./citationTags";
import {
  normalizeAliases,
  nextWeeklyRun,
  parseAliases,
} from "./citationHelpers";
import { finalizeRun, planRun, runPromptTask } from "./citationRunner";

const MAX_PROMPTS_PER_PROJECT = 50;

async function requireConfig(projectId: string) {
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
      "Save your tracker settings before adding prompts",
    );
  return config;
}

/**
 * Page payload. Deliberately excludes answer text — one run holds up to 400
 * answers, so the drill-in fetches a single response on demand instead.
 */
async function getOverview(projectId: string, runId?: string) {
  const config =
    (
      await db
        .select()
        .from(aiCitationTrackingConfigs)
        .where(eq(aiCitationTrackingConfigs.projectId, projectId))
        .limit(1)
    )[0] ?? null;

  const [configuredProviders, promptRows, tags, runs] = await Promise.all([
    getConfiguredCitationProviders(),
    db
      .select()
      .from(aiCitationTrackingPrompts)
      .where(eq(aiCitationTrackingPrompts.projectId, projectId))
      .orderBy(desc(aiCitationTrackingPrompts.createdAt)),
    db
      .select()
      .from(aiCitationTrackingTags)
      .where(eq(aiCitationTrackingTags.projectId, projectId))
      .orderBy(aiCitationTrackingTags.name),
    db
      .select()
      .from(aiCitationTrackingRuns)
      .where(eq(aiCitationTrackingRuns.projectId, projectId))
      .orderBy(desc(aiCitationTrackingRuns.createdAt))
      .limit(20),
  ]);

  const tagsByPrompt = await listPromptTags(projectId);
  const prompts = promptRows.map((prompt) => ({
    ...prompt,
    providers: prompt.providers
      ? parseCitationProviders(prompt.providers)
      : null,
    tags: tagsByPrompt.get(prompt.id) ?? [],
  }));

  // Default to the newest run that actually produced evidence, so the matrix
  // is populated rather than blank while a fresh run is still in flight.
  const selectedRun =
    (runId ? runs.find((run) => run.id === runId) : undefined) ??
    runs.find((run) => run.status === "completed") ??
    runs[0] ??
    null;

  const responses = selectedRun
    ? await db
        .select({
          id: aiCitationTrackingResponses.id,
          promptId: aiCitationTrackingResponses.promptId,
          provider: aiCitationTrackingResponses.provider,
          model: aiCitationTrackingResponses.model,
          brandMentioned: aiCitationTrackingResponses.brandMentioned,
          errorMessage: aiCitationTrackingResponses.errorMessage,
          // Whether the surface produced an answer at all, as a flag rather
          // than the text, which is far too large for the page payload. An
          // empty answer means something different from an answer that cited
          // nothing — see the `absent` state in CitationMatrix.
          hasAnswer: sql<number>`case when coalesce(${aiCitationTrackingResponses.answerText}, '') = '' then 0 else 1 end`,
        })
        .from(aiCitationTrackingResponses)
        .where(eq(aiCitationTrackingResponses.runId, selectedRun.id))
    : [];

  // Citations for exactly the selected run's responses, via a join on run id
  // rather than `inArray(responseIds)`. A 33-prompt x 4-provider run has 132
  // responses, and binding one parameter per id blows D1's ~100-parameter cap
  // so the whole page fails to load. The join binds exactly one.
  const citations = selectedRun
    ? await db
        .select({
          responseId: aiCitationTrackingCitations.responseId,
          domain: aiCitationTrackingCitations.domain,
          isTrackedDomain: aiCitationTrackingCitations.isTrackedDomain,
        })
        .from(aiCitationTrackingCitations)
        .innerJoin(
          aiCitationTrackingResponses,
          eq(
            aiCitationTrackingResponses.id,
            aiCitationTrackingCitations.responseId,
          ),
        )
        .where(eq(aiCitationTrackingResponses.runId, selectedRun.id))
        .orderBy(aiCitationTrackingCitations.citationOrder)
    : [];

  const citedByResponse = new Map<string, number>();
  const trackedByResponse = new Map<string, number>();
  for (const citation of citations) {
    citedByResponse.set(
      citation.responseId,
      (citedByResponse.get(citation.responseId) ?? 0) + 1,
    );
    if (citation.isTrackedDomain)
      trackedByResponse.set(
        citation.responseId,
        (trackedByResponse.get(citation.responseId) ?? 0) + 1,
      );
  }

  return {
    configuredProviders,
    config: config
      ? {
          ...config,
          brandAliases: parseAliases(config.brandAliases),
          providers: parseCitationProviders(config.providers),
        }
      : null,
    prompts,
    tags,
    runs,
    selectedRunId: selectedRun?.id ?? null,
    cells: responses.map((response) => ({
      ...response,
      hasAnswer: Number(response.hasAnswer) === 1,
      citationCount: citedByResponse.get(response.id) ?? 0,
      trackedCitationCount: trackedByResponse.get(response.id) ?? 0,
    })),
    topDomains: rankDomains(citations),
  };
}

function rankDomains(
  citations: { domain: string; isTrackedDomain: boolean }[],
): { domain: string; count: number; isTrackedDomain: boolean }[] {
  const counts = new Map<
    string,
    { domain: string; count: number; isTrackedDomain: boolean }
  >();
  for (const citation of citations) {
    const entry = counts.get(citation.domain) ?? {
      domain: citation.domain,
      count: 0,
      isTrackedDomain: citation.isTrackedDomain,
    };
    entry.count += 1;
    counts.set(citation.domain, entry);
  }
  return [...counts.values()]
    .toSorted((a, b) => b.count - a.count)
    .slice(0, 25);
}

/** Full evidence for one cell of the matrix. */
async function getResponseDetail(projectId: string, responseId: string) {
  const response = (
    await db
      .select()
      .from(aiCitationTrackingResponses)
      .where(
        and(
          eq(aiCitationTrackingResponses.id, responseId),
          eq(aiCitationTrackingResponses.projectId, projectId),
        ),
      )
      .limit(1)
  )[0];
  if (!response) throw new AppError("NOT_FOUND", "Response was not found");
  const citations = await db
    .select()
    .from(aiCitationTrackingCitations)
    .where(eq(aiCitationTrackingCitations.responseId, responseId))
    .orderBy(aiCitationTrackingCitations.citationOrder);
  return { response, citations };
}

async function saveConfig(input: {
  projectId: string;
  organizationId: string;
  userId: string;
  aliases: string[];
  providers: CitationProvider[];
  scheduleEnabled: boolean;
}) {
  const existing = (
    await db
      .select()
      .from(aiCitationTrackingConfigs)
      .where(eq(aiCitationTrackingConfigs.projectId, input.projectId))
      .limit(1)
  )[0];

  const values = {
    brandAliases: JSON.stringify(normalizeAliases(input.aliases)),
    providers: serializeCitationProviders(input.providers),
    scheduleEnabled: input.scheduleEnabled,
    updatedAt: new Date().toISOString(),
  };

  if (existing) {
    await db
      .update(aiCitationTrackingConfigs)
      .set({
        ...values,
        // Only (re)arm the clock on a real transition. Editing aliases used to
        // reset nextRunAt, silently pushing the weekly run out another 7 days.
        nextRunAt: !input.scheduleEnabled
          ? null
          : (existing.nextRunAt ?? nextWeeklyRun()),
      })
      .where(eq(aiCitationTrackingConfigs.id, existing.id));
    return;
  }

  await db.insert(aiCitationTrackingConfigs).values({
    id: crypto.randomUUID(),
    projectId: input.projectId,
    organizationId: input.organizationId,
    createdByUserId: input.userId,
    nextRunAt: input.scheduleEnabled ? nextWeeklyRun() : null,
    ...values,
  });
}

async function addPrompt(input: {
  projectId: string;
  label: string;
  prompt: string;
  providers: CitationProvider[] | null;
  tags: string[];
}) {
  const config = await requireConfig(input.projectId);
  const count = await db
    .select({ id: aiCitationTrackingPrompts.id })
    .from(aiCitationTrackingPrompts)
    .where(eq(aiCitationTrackingPrompts.projectId, input.projectId));
  if (count.length >= MAX_PROMPTS_PER_PROJECT)
    throw new AppError(
      "VALIDATION_ERROR",
      `You can track up to ${MAX_PROMPTS_PER_PROJECT} prompts per project`,
    );
  const id = crypto.randomUUID();
  await db.insert(aiCitationTrackingPrompts).values({
    id,
    configId: config.id,
    projectId: input.projectId,
    label: input.label.trim(),
    prompt: input.prompt.trim(),
    providers: input.providers
      ? serializeCitationProviders(input.providers)
      : null,
  });
  await setPromptTags(input.projectId, id, input.tags);
  return id;
}

async function updatePrompt(input: {
  projectId: string;
  promptId: string;
  enabled?: boolean;
  providers?: CitationProvider[] | null;
  tags?: string[];
}) {
  const changes: Record<string, unknown> = {};
  if (input.enabled !== undefined) changes.enabled = input.enabled;
  if (input.providers !== undefined)
    changes.providers = input.providers
      ? serializeCitationProviders(input.providers)
      : null;
  if (Object.keys(changes).length)
    await db
      .update(aiCitationTrackingPrompts)
      .set(changes)
      .where(
        and(
          eq(aiCitationTrackingPrompts.id, input.promptId),
          eq(aiCitationTrackingPrompts.projectId, input.projectId),
        ),
      );
  if (input.tags !== undefined)
    await setPromptTags(input.projectId, input.promptId, input.tags);
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
  const configured = await getConfiguredCitationProviders();
  const selected = parseCitationProviders(config.providers).filter((provider) =>
    configured.includes(provider),
  );
  if (selected.length === 0)
    throw new AppError(
      "VALIDATION_ERROR",
      "Select at least one AI provider that has an API key configured",
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

/**
 * Each Workflow step runs in its own invocation, so the configured-provider
 * set is resolved per step rather than threaded through the workflow payload.
 */
export const AiCitationTrackingService = {
  getOverview,
  getResponseDetail,
  saveConfig,
  addPrompt,
  updatePrompt,
  removePrompt,
  createRun,
  planRun: async (runId: string) =>
    planRun(runId, await getConfiguredCitationProviders()),
  runPromptTask: async (runId: string, promptId: string) =>
    runPromptTask(runId, promptId, await getConfiguredCitationProviders()),
  finalizeRun,
  listDueConfigs,
  advanceSchedule,
  // Exported for the provider catalogue the settings UI renders.
  allProviders: CITATION_PROVIDERS,
};
