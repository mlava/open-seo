import { z } from "zod";
import { buildProjectMeta } from "@/server/mcp/context";
import { mcpResponse } from "@/server/mcp/formatters";
import {
  looseObjectOutputSchema,
  optionalMetaOutputSchema,
} from "@/server/mcp/output-schemas";
import { withMcpProjectAuth } from "@/server/mcp/project-auth";
import { formatMcpTable, type McpTableColumn } from "@/server/mcp/table";
import { projectIdSchema } from "@/server/mcp/schemas";
import {
  getResponseCitations,
  getResults,
  listPromptsWithTags,
  type CitationResultRow,
  type PromptWithTags,
} from "@/server/features/ai-citation-tracking/citationReports";
import {
  CITATION_PROVIDER_LABELS,
  isCitationProvider,
} from "@/shared/ai-citation-providers";

function providerLabel(provider: string): string {
  return isCitationProvider(provider)
    ? CITATION_PROVIDER_LABELS[provider]
    : provider;
}

const PROMPT_COLUMNS: McpTableColumn<PromptWithTags>[] = [
  { header: "label", value: (row) => row.label },
  { header: "enabled", value: (row) => (row.enabled ? "yes" : "no") },
  { header: "tags", value: (row) => row.tags.join(", ") || "—" },
  {
    header: "providers",
    value: (row) =>
      row.providers ? row.providers.map(providerLabel).join(", ") : "default",
  },
  { header: "id", value: (row) => row.id },
];

const RESULT_COLUMNS: McpTableColumn<CitationResultRow>[] = [
  { header: "prompt", value: (row) => row.promptLabel },
  { header: "surface", value: (row) => providerLabel(row.provider) },
  {
    header: "outcome",
    value: (row) =>
      row.errorMessage
        ? "error"
        : row.trackedCitationCount > 0
          ? "cited you"
          : row.brandMentioned
            ? "mentioned only"
            : // Neither of these is absence. "no answer shown" means the
              // surface produced nothing (for a search surface, no AI answer
              // appeared); "cited nothing" means it answered but grounded on
              // no source, so it measures nothing about visibility.
              !row.hasAnswer && row.citationCount === 0
              ? "no answer shown"
              : row.citationCount === 0
                ? "cited nothing"
                : "no mention",
  },
  { header: "your citations", value: (row) => row.trackedCitationCount },
  { header: "all citations", value: (row) => row.citationCount },
];

const promptsInputSchema = {
  projectId: projectIdSchema,
  tag: z
    .string()
    .min(1)
    .max(60)
    .optional()
    .describe(
      "Only prompts carrying this tag. Case-insensitive exact match on the tag name.",
    ),
} as const;

type PromptsArgs = z.infer<z.ZodObject<typeof promptsInputSchema>>;

export const listAiCitationPromptsTool = {
  name: "list_ai_citation_prompts",
  config: {
    title: "List AI citation tracking prompts",
    description:
      "The prompts this project tracks against AI surfaces — the assistants ChatGPT, Claude, Gemini, Perplexity and Grok, plus the AI answers shown on a search results page (Google AI Overview, Google AI Mode, Bing Copilot) — each with its tags and any per-prompt surface override. Also returns every tag defined on the project, so you can discover tags before filtering by one. Use this to find a prompt id or tag to pass to get_ai_citation_results. Read-only; uses no credits.",
    inputSchema: promptsInputSchema,
    outputSchema: {
      ok: z.boolean(),
      promptCount: z.number(),
      prompts: z.array(looseObjectOutputSchema),
      allTags: z.array(z.string()),
      ...optionalMetaOutputSchema,
    },
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
      destructiveHint: false,
    },
  },
  handler: withMcpProjectAuth(async (args: PromptsArgs, context) => {
    const meta = buildProjectMeta(
      context,
      args.projectId,
      `/p/${args.projectId}/ai-citation-tracking`,
    );
    const { prompts, allTags } = await listPromptsWithTags(
      args.projectId,
      args.tag,
    );

    if (prompts.length === 0) {
      const reason = args.tag
        ? `No prompts carry the tag "${args.tag}".${allTags.length ? ` Tags in use: ${allTags.join(", ")}.` : ""}`
        : `No prompts tracked yet. Add them on the AI Citation Tracking page: ${meta.url}`;
      return mcpResponse({
        text: reason,
        meta,
        structuredContent: { ok: true, promptCount: 0, prompts: [], allTags },
      });
    }

    const header = `${prompts.length} prompt${prompts.length === 1 ? "" : "s"}${
      args.tag ? ` tagged "${args.tag}"` : ""
    }${allTags.length ? ` · tags in use: ${allTags.join(", ")}` : ""}`;
    return mcpResponse({
      text: `${header}\n${formatMcpTable(prompts, PROMPT_COLUMNS)}`,
      meta,
      structuredContent: {
        ok: true,
        promptCount: prompts.length,
        prompts,
        allTags,
      },
    });
  }),
};

const resultsInputSchema = {
  projectId: projectIdSchema,
  promptId: z
    .string()
    .optional()
    .describe(
      "Only this prompt, across every assistant. Also returns the cited sources for each answer. Get ids from list_ai_citation_prompts.",
    ),
  tag: z
    .string()
    .min(1)
    .max(60)
    .optional()
    .describe(
      "Only prompts carrying this tag. Case-insensitive exact match on the tag name.",
    ),
  runId: z
    .string()
    .optional()
    .describe(
      "A specific tracking run. Defaults to the most recent completed run.",
    ),
} as const;

type ResultsArgs = z.infer<z.ZodObject<typeof resultsInputSchema>>;

export const getAiCitationResultsTool = {
  name: "get_ai_citation_results",
  config: {
    title: "Get AI citation tracking results",
    description:
      "How each AI surface answered this project's tracked prompts in a run, and whether it cited the project's own domains. Surfaces are the assistants (ChatGPT, Claude, Gemini, Perplexity, Grok) and the AI answers on a search results page (Google AI Overview, Google AI Mode, Bing Copilot). One row per prompt and surface, with counts of tracked-domain citations versus all citations. Filter to one prompt with promptId (which also returns each answer's cited source URLs) or to a group of prompts with tag. Defaults to the latest completed run. Read-only; uses no credits — the run itself is what spends API budget.",
    inputSchema: resultsInputSchema,
    outputSchema: {
      ok: z.boolean(),
      runId: z.string().optional(),
      runStatus: z.string().optional(),
      runCreatedAt: z.string().optional(),
      rowCount: z.number(),
      rows: z.array(looseObjectOutputSchema),
      citations: z.array(looseObjectOutputSchema).optional(),
      ...optionalMetaOutputSchema,
    },
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
      destructiveHint: false,
    },
  },
  handler: withMcpProjectAuth(async (args: ResultsArgs, context) => {
    const meta = buildProjectMeta(
      context,
      args.projectId,
      `/p/${args.projectId}/ai-citation-tracking`,
    );
    const { run, rows } = await getResults(args.projectId, {
      runId: args.runId,
      promptId: args.promptId,
      tag: args.tag,
    });

    if (!run) {
      return mcpResponse({
        text: `No tracking run has completed yet for this project. Start one on the AI Citation Tracking page: ${meta.url}`,
        meta,
        structuredContent: { ok: true, rowCount: 0, rows: [] },
      });
    }
    if (rows.length === 0) {
      const filter = args.promptId
        ? `prompt ${args.promptId}`
        : args.tag
          ? `tag "${args.tag}"`
          : "this run";
      return mcpResponse({
        text: `Run ${run.createdAt} (${run.status}) recorded no answers for ${filter}.`,
        meta,
        structuredContent: {
          ok: true,
          runId: run.id,
          runStatus: run.status,
          rowCount: 0,
          rows: [],
        },
      });
    }

    // Source URLs only for a single prompt: a whole run is up to 400 answers
    // and their citations would swamp the response.
    const citations = args.promptId
      ? await getResponseCitations(
          args.projectId,
          rows.map((row) => row.responseId),
        )
      : undefined;

    const cited = rows.filter((row) => row.trackedCitationCount > 0).length;
    const failed = rows.filter((row) => row.errorMessage).length;
    const header = `Run ${run.createdAt} (${run.status}) · ${rows.length} answer${
      rows.length === 1 ? "" : "s"
    } · cited you in ${cited}${failed ? ` · ${failed} failed` : ""}`;
    const sourceLines = citations?.length
      ? `\n\nCited sources:\n${citations
          .map(
            (citation) =>
              `${citation.isTrackedDomain ? "* " : "  "}${citation.domain} — ${citation.url}`,
          )
          .join("\n")}`
      : "";

    return mcpResponse({
      text: `${header}\n${formatMcpTable(rows, RESULT_COLUMNS)}${sourceLines}`,
      meta,
      structuredContent: {
        ok: true,
        runId: run.id,
        runStatus: run.status,
        runCreatedAt: run.createdAt,
        rowCount: rows.length,
        rows,
        ...(citations ? { citations } : {}),
      },
    });
  }),
};
