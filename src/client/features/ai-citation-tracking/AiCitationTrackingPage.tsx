import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import { TagChip } from "@/client/features/saved-keywords/TagChip";
import {
  getAiCitationTrackingOverview,
  startAiCitationTrackingRun,
} from "@/serverFunctions/ai-citation-tracking";
import {
  sortCitationProviders,
  type CitationProvider,
} from "@/shared/ai-citation-providers";
import {
  CitationMatrix,
  type MatrixCell,
  type MatrixPrompt,
} from "./CitationMatrix";
import { CitationProvidersCard } from "./CitationProvidersCard";
import { CitationResponseModal } from "./CitationResponseModal";
import { PanelError, PanelLoading, StatTile } from "./citationParts";
import {
  PromptRegistryPanel,
  type RegistryPrompt,
} from "./PromptRegistryPanel";
import { TrackerSettingsPanel } from "./TrackerSettingsPanel";

type Overview = Awaited<ReturnType<typeof getAiCitationTrackingOverview>>;
type OpenCell = { responseId: string; promptLabel: string };

/**
 * Private, historical evidence of how AI assistants answer your tracked
 * prompts and which sources they cite. Each assistant is called directly with
 * the operator's own API key and its native web search — an aggregator's
 * search would measure the aggregator, not the assistant.
 */
export function AiCitationTrackingPage({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const [runId, setRunId] = React.useState<string | undefined>(undefined);
  const [tagFilter, setTagFilter] = React.useState<string | null>(null);
  const [openCell, setOpenCell] = React.useState<OpenCell | null>(null);

  const query = useQuery({
    queryKey: ["aiCitationTracking", projectId, runId ?? "latest"],
    queryFn: () =>
      getAiCitationTrackingOverview({ data: { projectId, runId } }),
  });

  const refresh = () =>
    void queryClient.invalidateQueries({
      queryKey: ["aiCitationTracking", projectId],
    });

  const startRun = useMutation({
    mutationFn: () => startAiCitationTrackingRun({ data: { projectId } }),
    onSuccess: () => {
      toast.success("Citation-tracking batch started");
      refresh();
    },
    onError: (error) => toast.error(getStandardErrorMessage(error)),
  });

  const data = query.data;
  const configuredProviders = data?.configuredProviders ?? [];
  const defaultProviders = data?.config?.providers ?? [];
  // Columns are the providers the selected run could actually have used.
  const columns = sortCitationProviders(
    defaultProviders.filter((provider) =>
      configuredProviders.includes(provider),
    ),
  );

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">AI Citation Tracking</h1>
          <p className="text-sm text-base-content/70">
            Weekly, private evidence of how AI assistants answer your tracked
            prompts and which sources they cite.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={
            startRun.isPending ||
            !data?.config ||
            data.prompts.length === 0 ||
            columns.length === 0
          }
          onClick={() => startRun.mutate()}
        >
          {startRun.isPending ? "Starting…" : "Run now"}
        </button>
      </div>

      {query.isLoading ? (
        <PanelLoading label="Loading citation tracking…" />
      ) : query.isError || !data ? (
        <PanelError onRetry={() => void query.refetch()} />
      ) : (
        <>
          <SummaryTiles data={data} columnCount={columns.length} />

          <CitationProvidersCard configured={configuredProviders} />

          <ResultsSection
            data={data}
            columns={columns}
            tagFilter={tagFilter}
            onTagFilter={setTagFilter}
            onSelectRun={setRunId}
            onSelectCell={setOpenCell}
          />

          <TopDomains data={data} />

          <TrackerSettingsPanel
            // Remount when the stored config changes so the form picks up
            // server state without an effect that fights the user's typing.
            key={data.config?.updatedAt ?? "new"}
            projectId={projectId}
            configuredProviders={configuredProviders}
            initialAliases={data.config?.brandAliases ?? []}
            initialProviders={
              data.config?.providers ??
              configuredProviders.filter((provider) => provider === "openai")
            }
            initialScheduleEnabled={data.config?.scheduleEnabled ?? true}
            onSaved={refresh}
          />

          <PromptRegistryPanel
            projectId={projectId}
            prompts={data.prompts as RegistryPrompt[]}
            configuredProviders={configuredProviders}
            defaultProviders={defaultProviders}
            onChanged={refresh}
          />

          <RunHistoryTable runs={data.runs} />
        </>
      )}

      {openCell ? (
        <CitationResponseModal
          projectId={projectId}
          responseId={openCell.responseId}
          promptLabel={openCell.promptLabel}
          onClose={() => setOpenCell(null)}
        />
      ) : null}
    </div>
  );
}

function SummaryTiles({
  data,
  columnCount,
}: {
  data: Overview;
  columnCount: number;
}) {
  const trackedCitations = data.cells.reduce(
    (total, cell) => total + cell.trackedCitationCount,
    0,
  );
  const enabled = data.prompts.filter((prompt) => prompt.enabled).length;
  const completed = data.runs.filter(
    (run) => run.status === "completed",
  ).length;

  return (
    <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <StatTile
        label="Tracked prompts"
        value={String(data.prompts.length)}
        hint={`${enabled} enabled`}
      />
      <StatTile
        label="Providers"
        value={String(columnCount)}
        hint={`${data.configuredProviders.length} with a key`}
      />
      <StatTile
        label="Your citations"
        value={String(trackedCitations)}
        hint="in the selected run"
      />
      <StatTile label="Completed runs" value={String(completed)} />
    </section>
  );
}

function ResultsSection({
  data,
  columns,
  tagFilter,
  onTagFilter,
  onSelectRun,
  onSelectCell,
}: {
  data: Overview;
  columns: CitationProvider[];
  tagFilter: string | null;
  onTagFilter: (tagId: string | null) => void;
  onSelectRun: (runId: string) => void;
  onSelectCell: (cell: OpenCell) => void;
}) {
  const prompts = data.prompts.filter(
    (prompt) => !tagFilter || prompt.tags.some((tag) => tag.id === tagFilter),
  );
  const promptLabels = new Map(
    data.prompts.map((prompt) => [prompt.id, prompt.label]),
  );
  const hasRun = data.runs.some((run) => run.id === data.selectedRunId);

  return (
    <section className="rounded-xl border border-base-300 bg-base-100 p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold">Results by prompt and provider</h2>
          <p className="mt-1 text-sm text-base-content/65">
            Select a cell to read the answer and the sources it cited.
          </p>
        </div>
        {data.runs.length > 0 ? (
          <select
            className="select select-bordered select-sm min-w-56"
            aria-label="Run"
            value={data.selectedRunId ?? ""}
            onChange={(event) => onSelectRun(event.target.value)}
          >
            {data.runs.map((run) => (
              <option key={run.id} value={run.id}>
                {new Date(run.createdAt).toLocaleString()} · {run.trigger} ·{" "}
                {run.status}
              </option>
            ))}
          </select>
        ) : null}
      </div>

      {data.tags.length > 0 ? (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            className={`btn btn-xs ${tagFilter ? "btn-ghost" : "btn-neutral"}`}
            onClick={() => onTagFilter(null)}
          >
            All
          </button>
          {data.tags.map((tag) => (
            <TagChip
              key={tag.id}
              tag={tag}
              size="xs"
              selected={tagFilter === tag.id}
              onClick={() => onTagFilter(tagFilter === tag.id ? null : tag.id)}
            />
          ))}
        </div>
      ) : null}

      <div className="mt-4">
        {!hasRun ? (
          <p className="text-sm text-base-content/60">
            Evidence appears here after the first run completes.
          </p>
        ) : columns.length === 0 ? (
          <p className="text-sm text-base-content/60">
            Select at least one provider in tracker settings.
          </p>
        ) : (
          <CitationMatrix
            prompts={prompts as MatrixPrompt[]}
            providers={columns}
            cells={data.cells as MatrixCell[]}
            onSelectCell={(cell) =>
              onSelectCell({
                responseId: cell.id,
                promptLabel: promptLabels.get(cell.promptId) ?? "Prompt",
              })
            }
          />
        )}
      </div>
    </section>
  );
}

function TopDomains({ data }: { data: Overview }) {
  if (data.topDomains.length === 0) return null;
  return (
    <section className="rounded-xl border border-base-300 bg-base-100 p-4 shadow-sm">
      <h2 className="font-semibold">Most-cited domains</h2>
      <p className="mt-1 text-sm text-base-content/65">
        Across every answer in the selected run.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {data.topDomains.map((entry) => (
          <span
            key={entry.domain}
            className={`inline-flex items-center gap-2 rounded-md px-2 py-1 text-sm ${
              entry.isTrackedDomain
                ? "bg-success/15 text-success"
                : "bg-base-200"
            }`}
          >
            {entry.domain}
            <span className="text-xs tabular-nums opacity-70">
              {entry.count}
            </span>
          </span>
        ))}
      </div>
    </section>
  );
}

function RunHistoryTable({ runs }: { runs: Overview["runs"] }) {
  return (
    <section className="rounded-xl border border-base-300 bg-base-100 p-4 shadow-sm">
      <h2 className="font-semibold">Run history</h2>
      <div className="mt-3 overflow-x-auto">
        <table className="table table-sm">
          <thead>
            <tr>
              <th>When</th>
              <th>Trigger</th>
              <th>Prompts</th>
              <th>Calls</th>
              <th>Result</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <tr key={run.id}>
                <td>{new Date(run.createdAt).toLocaleString()}</td>
                <td>{run.trigger}</td>
                <td className="tabular-nums">{run.promptCount}</td>
                <td className="tabular-nums">{run.taskCount}</td>
                <td>
                  {run.status} · {run.succeededCount} succeeded
                  {run.failedCount ? `, ${run.failedCount} failed` : ""}
                </td>
              </tr>
            ))}
            {runs.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-base-content/60">
                  No runs yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
