import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  aiCitationTrackingCitations,
  aiCitationTrackingPrompts,
  aiCitationTrackingPromptTags,
  aiCitationTrackingResponses,
  aiCitationTrackingRuns,
  aiCitationTrackingTags,
} from "@/db/schema";
import { parseCitationProviders } from "@/shared/ai-citation-providers";

/**
 * Read models for the MCP tools. Kept apart from AiCitationTrackingService,
 * which serves the page: agents want prompts and results filtered by tag or by
 * prompt, and never need the config/registry plumbing the tab renders.
 *
 * Every query filters by a single indexed column or joins on one. None binds a
 * parameter per row — a full run is 250 responses and D1 caps a statement at
 * ~100 bound parameters.
 */

/** Newest run with evidence, or a specific one. Null when nothing has run. */
async function resolveRun(projectId: string, runId?: string) {
  if (runId) {
    return (
      (
        await db
          .select()
          .from(aiCitationTrackingRuns)
          .where(
            and(
              eq(aiCitationTrackingRuns.id, runId),
              eq(aiCitationTrackingRuns.projectId, projectId),
            ),
          )
          .limit(1)
      )[0] ?? null
    );
  }
  const runs = await db
    .select()
    .from(aiCitationTrackingRuns)
    .where(eq(aiCitationTrackingRuns.projectId, projectId))
    .orderBy(desc(aiCitationTrackingRuns.createdAt))
    .limit(20);
  return runs.find((run) => run.status === "completed") ?? runs[0] ?? null;
}

export type PromptWithTags = {
  id: string;
  label: string;
  prompt: string;
  enabled: boolean;
  providers: string[] | null;
  tags: string[];
};

/**
 * The project's tracked prompts, each with its tags. `tag` filters to prompts
 * carrying that tag, matched case-insensitively on the normalised name.
 */
export async function listPromptsWithTags(
  projectId: string,
  tag?: string,
): Promise<{ prompts: PromptWithTags[]; allTags: string[] }> {
  const promptRows = await db
    .select()
    .from(aiCitationTrackingPrompts)
    .where(eq(aiCitationTrackingPrompts.projectId, projectId))
    .orderBy(desc(aiCitationTrackingPrompts.createdAt));

  const tagRows = await db
    .select({
      promptId: aiCitationTrackingPromptTags.promptId,
      name: aiCitationTrackingTags.name,
      normalizedName: aiCitationTrackingTags.normalizedName,
    })
    .from(aiCitationTrackingPromptTags)
    .innerJoin(
      aiCitationTrackingTags,
      eq(aiCitationTrackingTags.id, aiCitationTrackingPromptTags.tagId),
    )
    .where(eq(aiCitationTrackingTags.projectId, projectId));

  const byPrompt = new Map<string, string[]>();
  const allTags = new Set<string>();
  for (const row of tagRows) {
    allTags.add(row.name);
    byPrompt.set(row.promptId, [
      ...(byPrompt.get(row.promptId) ?? []),
      row.name,
    ]);
  }

  const wanted = tag?.trim().toLocaleLowerCase();
  const matching = wanted
    ? new Set(
        tagRows
          .filter((row) => row.normalizedName === wanted)
          .map((row) => row.promptId),
      )
    : null;

  const prompts = promptRows
    .filter((prompt) => !matching || matching.has(prompt.id))
    .map((prompt) => ({
      id: prompt.id,
      label: prompt.label,
      prompt: prompt.prompt,
      enabled: prompt.enabled,
      providers: prompt.providers
        ? parseCitationProviders(prompt.providers)
        : null,
      tags: byPrompt.get(prompt.id) ?? [],
    }));

  return { prompts, allTags: [...allTags].toSorted() };
}

export type CitationResultRow = {
  responseId: string;
  promptId: string;
  promptLabel: string;
  provider: string;
  model: string;
  brandMentioned: boolean;
  errorMessage: string | null;
  citationCount: number;
  trackedCitationCount: number;
};

/**
 * One row per prompt x provider for a run, optionally narrowed to a single
 * prompt or to prompts carrying a tag. Citation counts come from a grouped
 * join rather than a second pass, so the row count never affects the
 * parameter count.
 */
export async function getResults(
  projectId: string,
  options: { runId?: string; promptId?: string; tag?: string } = {},
) {
  const run = await resolveRun(projectId, options.runId);
  if (!run) return { run: null, rows: [] as CitationResultRow[] };

  const filters = [eq(aiCitationTrackingResponses.runId, run.id)];
  if (options.promptId)
    filters.push(eq(aiCitationTrackingResponses.promptId, options.promptId));

  if (options.tag) {
    const { prompts } = await listPromptsWithTags(projectId, options.tag);
    if (prompts.length === 0) return { run, rows: [] as CitationResultRow[] };
    // Bounded by MAX_PROMPTS_PER_PROJECT (50), so this stays inside D1's
    // ~100-parameter ceiling even with the run filter alongside it.
    filters.push(
      inArray(
        aiCitationTrackingResponses.promptId,
        prompts.map((prompt) => prompt.id),
      ),
    );
  }

  const rows = await db
    .select({
      responseId: aiCitationTrackingResponses.id,
      promptId: aiCitationTrackingResponses.promptId,
      promptLabel: aiCitationTrackingPrompts.label,
      provider: aiCitationTrackingResponses.provider,
      model: aiCitationTrackingResponses.model,
      brandMentioned: aiCitationTrackingResponses.brandMentioned,
      errorMessage: aiCitationTrackingResponses.errorMessage,
      citationCount: sql<number>`count(${aiCitationTrackingCitations.id})`,
      trackedCitationCount: sql<number>`sum(case when ${aiCitationTrackingCitations.isTrackedDomain} then 1 else 0 end)`,
    })
    .from(aiCitationTrackingResponses)
    .innerJoin(
      aiCitationTrackingPrompts,
      eq(aiCitationTrackingPrompts.id, aiCitationTrackingResponses.promptId),
    )
    .leftJoin(
      aiCitationTrackingCitations,
      eq(
        aiCitationTrackingCitations.responseId,
        aiCitationTrackingResponses.id,
      ),
    )
    .where(and(...filters))
    .groupBy(aiCitationTrackingResponses.id, aiCitationTrackingPrompts.label)
    .orderBy(aiCitationTrackingPrompts.label);

  return {
    run,
    // count()/sum() come back as strings on some drivers; normalise here so
    // callers can treat them as numbers.
    rows: rows.map((row) => ({
      ...row,
      citationCount: Number(row.citationCount ?? 0),
      trackedCitationCount: Number(row.trackedCitationCount ?? 0),
    })),
  };
}

/** Cited sources for one response, for the by-prompt drill-in. */
export async function getResponseCitations(
  projectId: string,
  responseIds: readonly string[],
) {
  if (responseIds.length === 0) return [];
  return db
    .select({
      responseId: aiCitationTrackingCitations.responseId,
      url: aiCitationTrackingCitations.url,
      domain: aiCitationTrackingCitations.domain,
      title: aiCitationTrackingCitations.title,
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
    .where(
      and(
        eq(aiCitationTrackingResponses.projectId, projectId),
        // One prompt across five providers is at most five ids.
        inArray(aiCitationTrackingCitations.responseId, [...responseIds]),
      ),
    )
    .orderBy(aiCitationTrackingCitations.citationOrder);
}
