import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  aiCitationTrackingCitations,
  aiCitationTrackingConfigs,
  aiCitationTrackingPrompts,
  aiCitationTrackingResponses,
  aiCitationTrackingRuns,
} from "@/db/schema";
import {
  parseCitationProviders,
  sortCitationProviders,
  type CitationProvider,
} from "@/shared/ai-citation-providers";
import { deriveBrandTerms, textMentionsBrand } from "@/shared/brand-mentions";
import { aliasDomain, parseAliases, safeDomain } from "./citationHelpers";
import { runCitationPrompt } from "./citationClient";

/** Providers for one prompt run concurrently; prompts are one Workflow step each. */
const PROVIDER_CONCURRENCY = 5;

/**
 * Which providers a prompt runs against: its own override when set, otherwise
 * the project default. Either way it is bounded by the providers this instance
 * holds a key for, so a revoked key degrades the run instead of failing it.
 */
export function providersForPrompt(
  prompt: { providers: string | null },
  projectDefault: CitationProvider[],
  configured: readonly CitationProvider[],
): CitationProvider[] {
  const chosen = prompt.providers
    ? parseCitationProviders(prompt.providers)
    : projectDefault;
  return sortCitationProviders(
    chosen.filter((provider) => configured.includes(provider)),
  );
}

async function loadRunPlan(
  runId: string,
  configured: readonly CitationProvider[],
) {
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
  return {
    run,
    config,
    prompts,
    configured,
    projectDefault: parseCitationProviders(config.providers),
  };
}

/** Step 1 of the Workflow: freeze the work list and mark the run running. */
export async function planRun(
  runId: string,
  configured: readonly CitationProvider[],
) {
  const { run, prompts, projectDefault } = await loadRunPlan(runId, configured);
  const planned = prompts
    .map((prompt) => ({
      promptId: prompt.id,
      providers: providersForPrompt(prompt, projectDefault, configured),
    }))
    .filter((entry) => entry.providers.length > 0);
  const taskCount = planned.reduce(
    (total, entry) => total + entry.providers.length,
    0,
  );
  await db
    .update(aiCitationTrackingRuns)
    .set({
      status: "running",
      startedAt: run.startedAt ?? new Date().toISOString(),
      promptCount: planned.length,
      taskCount,
    })
    .where(eq(aiCitationTrackingRuns.id, runId));
  return { promptIds: planned.map((entry) => entry.promptId) };
}

/**
 * Step 2 (one per prompt): ask every selected provider and store the evidence.
 * Tasks already recorded for this run are skipped, so a step retry after a
 * partial pass never re-spends the API budget on work that already landed.
 */
export async function runPromptTask(
  runId: string,
  promptId: string,
  configured: readonly CitationProvider[],
) {
  const { run, config, prompts, projectDefault } = await loadRunPlan(
    runId,
    configured,
  );
  const prompt = prompts.find((entry) => entry.id === promptId);
  if (!prompt) return { skipped: true as const };

  const done = new Set(
    (
      await db
        .select({ provider: aiCitationTrackingResponses.provider })
        .from(aiCitationTrackingResponses)
        .where(
          and(
            eq(aiCitationTrackingResponses.runId, runId),
            eq(aiCitationTrackingResponses.promptId, promptId),
          ),
        )
    ).map((row) => row.provider),
  );
  const pending = providersForPrompt(prompt, projectDefault, configured).filter(
    (provider) => !done.has(provider),
  );
  if (pending.length === 0) return { skipped: true as const };

  const aliases = parseAliases(config.brandAliases);
  const brandTerms = deriveBrandTerms(aliases);
  const trackedDomains = new Set(
    aliases
      .map(aliasDomain)
      .filter((domain): domain is string => Boolean(domain)),
  );

  for (let index = 0; index < pending.length; index += PROVIDER_CONCURRENCY) {
    await Promise.all(
      pending.slice(index, index + PROVIDER_CONCURRENCY).map((provider) =>
        storeProviderResponse({
          runId,
          projectId: run.projectId,
          prompt,
          provider,
          brandTerms,
          trackedDomains,
        }),
      ),
    );
  }
  return { skipped: false as const };
}

async function storeProviderResponse(input: {
  runId: string;
  projectId: string;
  prompt: { id: string; prompt: string };
  provider: CitationProvider;
  brandTerms: string[];
  trackedDomains: Set<string>;
}) {
  const responseId = crypto.randomUUID();
  try {
    const result = await runCitationPrompt(input.provider, input.prompt.prompt);
    await db.insert(aiCitationTrackingResponses).values({
      id: responseId,
      runId: input.runId,
      promptId: input.prompt.id,
      projectId: input.projectId,
      provider: input.provider,
      model: result.model,
      answerText: result.answerText,
      brandMentioned: textMentionsBrand(result.answerText, input.brandTerms),
    });
    const rows = result.sources.flatMap((source, citationOrder) => {
      const domain = safeDomain(source.url);
      return domain
        ? [
            {
              id: crypto.randomUUID(),
              responseId,
              projectId: input.projectId,
              url: source.url,
              domain,
              title: source.title,
              citationOrder,
              isTrackedDomain: input.trackedDomains.has(domain),
            },
          ]
        : [];
    });
    if (rows.length) await db.insert(aiCitationTrackingCitations).values(rows);
  } catch (error) {
    // Log upstream detail server-side; the stored message is what the UI shows.
    console.error(
      `[citation-tracking] ${input.provider} failed for prompt ${input.prompt.id}:`,
      error,
    );
    await db.insert(aiCitationTrackingResponses).values({
      id: responseId,
      runId: input.runId,
      promptId: input.prompt.id,
      projectId: input.projectId,
      provider: input.provider,
      model: "unknown",
      errorMessage:
        error instanceof Error ? error.message : "Provider request failed",
    });
  }
}

/**
 * Step 3: totals are counted from stored rows rather than in-memory counters,
 * so a run resumed across Workflow restarts still reports its true totals.
 */
export async function finalizeRun(runId: string) {
  const rows = await db
    .select({ errorMessage: aiCitationTrackingResponses.errorMessage })
    .from(aiCitationTrackingResponses)
    .where(eq(aiCitationTrackingResponses.runId, runId));
  const failed = rows.filter((row) => row.errorMessage).length;
  const succeeded = rows.length - failed;
  await db
    .update(aiCitationTrackingRuns)
    .set({
      status: succeeded === 0 && failed > 0 ? "failed" : "completed",
      succeededCount: succeeded,
      failedCount: failed,
      completedAt: new Date().toISOString(),
      errorMessage: failed
        ? `${failed} provider call${failed === 1 ? "" : "s"} failed`
        : null,
    })
    .where(eq(aiCitationTrackingRuns.id, runId));
  return { succeeded, failed };
}
