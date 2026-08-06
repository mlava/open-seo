import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import {
  addAiCitationTrackingPrompt,
  getAiCitationTrackingOverview,
  removeAiCitationTrackingPrompt,
  saveAiCitationTrackingSettings,
  startAiCitationTrackingRun,
} from "@/serverFunctions/ai-citation-tracking";

/** Private historical evidence from OpenAI web-search responses. */
export function AiCitationTrackingPage({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const key = React.useMemo(
    () => ["aiCitationTracking", projectId],
    [projectId],
  );
  const query = useQuery({
    queryKey: key,
    queryFn: () => getAiCitationTrackingOverview({ data: { projectId } }),
  });
  const [aliases, setAliases] = React.useState("");
  const [scheduleEnabled, setScheduleEnabled] = React.useState(true);
  const [label, setLabel] = React.useState("");
  const [prompt, setPrompt] = React.useState("");

  React.useEffect(() => {
    if (!query.data?.config) return;
    setAliases(query.data.config.brandAliases.join(", "));
    setScheduleEnabled(query.data.config.scheduleEnabled);
  }, [query.data?.config]);
  const refresh = () => queryClient.invalidateQueries({ queryKey: key });
  const settings = useMutation({
    mutationFn: () =>
      saveAiCitationTrackingSettings({
        data: {
          projectId,
          aliases: aliases
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean),
          scheduleEnabled,
        },
      }),
    onSuccess: () => {
      toast.success("Tracker settings saved");
      void refresh();
    },
    onError: (error) => toast.error(getStandardErrorMessage(error)),
  });
  const addPrompt = useMutation({
    mutationFn: () =>
      addAiCitationTrackingPrompt({ data: { projectId, label, prompt } }),
    onSuccess: () => {
      setLabel("");
      setPrompt("");
      toast.success("Prompt added");
      void refresh();
    },
    onError: (error) => toast.error(getStandardErrorMessage(error)),
  });
  const removePrompt = useMutation({
    mutationFn: (promptId: string) =>
      removeAiCitationTrackingPrompt({ data: { projectId, promptId } }),
    onSuccess: () => void refresh(),
    onError: (error) => toast.error(getStandardErrorMessage(error)),
  });
  const startRun = useMutation({
    mutationFn: () => startAiCitationTrackingRun({ data: { projectId } }),
    onSuccess: () => {
      toast.success("Citation-tracking batch started");
      void refresh();
    },
    onError: (error) => toast.error(getStandardErrorMessage(error)),
  });
  const data = query.data;
  const trackedCitations =
    data?.citations.filter((citation) => citation.isTrackedDomain).length ?? 0;

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">AI Citation Tracking</h1>
          <p className="text-sm text-base-content/70">
            Weekly, private evidence of how OpenAI web search answers and cites
            your tracked topics.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={
            !data?.configured ||
            startRun.isPending ||
            !data.config ||
            data.prompts.length === 0
          }
          onClick={() => startRun.mutate()}
        >
          {startRun.isPending ? "Starting…" : "Run now"}
        </button>
      </div>
      {!data?.configured ? (
        <div className="alert alert-warning">
          <span>
            Set the <code>OPENAI_API_KEY</code> Worker secret to enable
            collection. ChatGPT sign-in cannot supply API usage.
          </span>
        </div>
      ) : null}
      {query.isLoading ? (
        <span className="loading loading-spinner loading-sm" />
      ) : query.isError ? (
        <div className="alert alert-error">
          <span>Couldn’t load citation tracking.</span>
        </div>
      ) : (
        <>
          <section className="grid gap-3 sm:grid-cols-3">
            <Metric label="Tracked prompts" value={data?.prompts.length ?? 0} />
            <Metric label="Tracked-domain citations" value={trackedCitations} />
            <Metric
              label="Completed runs"
              value={
                data?.runs.filter((run) => run.status === "completed").length ??
                0
              }
            />
          </section>
          <section className="rounded-xl border border-base-300 bg-base-100 p-4 shadow-sm">
            <h2 className="font-semibold">Tracker settings</h2>
            <p className="mt-1 text-sm text-base-content/65">
              Use domains such as <code>scholarsidekick.com</code> (not paths)
              to mark your own citations.
            </p>
            <form
              className="mt-4 space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                settings.mutate();
              }}
            >
              <input
                className="input input-bordered w-full"
                value={aliases}
                onChange={(event) => setAliases(event.target.value)}
                placeholder="scholarsidekick.com, agentready.io"
              />
              <label className="label w-fit cursor-pointer gap-3">
                <span className="label-text">Run weekly</span>
                <input
                  type="checkbox"
                  className="toggle toggle-primary"
                  checked={scheduleEnabled}
                  onChange={(event) => setScheduleEnabled(event.target.checked)}
                />
              </label>
              <button className="btn btn-sm" disabled={settings.isPending}>
                {settings.isPending ? "Saving…" : "Save settings"}
              </button>
            </form>
          </section>
          <section className="rounded-xl border border-base-300 bg-base-100 p-4 shadow-sm">
            <h2 className="font-semibold">Prompt registry</h2>
            <p className="mt-1 text-sm text-base-content/65">
              Keep prompts stable to make week-over-week evidence comparable.
            </p>
            <form
              className="mt-4 grid gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                addPrompt.mutate();
              }}
            >
              <input
                className="input input-bordered"
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                placeholder="Prompt label"
                maxLength={120}
              />
              <textarea
                className="textarea textarea-bordered min-h-24"
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder="What are the best scholarly identifier lookup tools?"
                maxLength={4000}
              />
              <div>
                <button
                  className="btn btn-sm"
                  disabled={
                    !label.trim() || !prompt.trim() || addPrompt.isPending
                  }
                >
                  {addPrompt.isPending ? "Adding…" : "Add prompt"}
                </button>
              </div>
            </form>
            <div className="mt-4 space-y-2">
              {data?.prompts.map((item) => (
                <div
                  key={item.id}
                  className="flex items-start justify-between gap-3 rounded-lg bg-base-200 p-3"
                >
                  <div>
                    <p className="font-medium">{item.label}</p>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-base-content/70">
                      {item.prompt}
                    </p>
                  </div>
                  <button
                    className="btn btn-ghost btn-xs text-error"
                    onClick={() => removePrompt.mutate(item.id)}
                    disabled={removePrompt.isPending}
                  >
                    Remove
                  </button>
                </div>
              ))}
              {data?.prompts.length === 0 ? (
                <p className="text-sm text-base-content/60">No prompts yet.</p>
              ) : null}
            </div>
          </section>
          <section className="rounded-xl border border-base-300 bg-base-100 p-4 shadow-sm">
            <h2 className="font-semibold">Recent evidence</h2>
            <div className="mt-3 overflow-x-auto">
              <table className="table table-sm">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Run</th>
                    <th>Prompts</th>
                    <th>Result</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.runs.map((run) => (
                    <tr key={run.id}>
                      <td>{new Date(run.createdAt).toLocaleString()}</td>
                      <td>{run.trigger}</td>
                      <td>{run.promptCount}</td>
                      <td>
                        {run.status} · {run.succeededCount} succeeded
                        {run.failedCount ? `, ${run.failedCount} failed` : ""}
                      </td>
                    </tr>
                  ))}
                  {data?.runs.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="text-base-content/60">
                        No runs yet.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>
          <section className="rounded-xl border border-base-300 bg-base-100 p-4 shadow-sm">
            <h2 className="font-semibold">Latest cited sources</h2>
            <div className="mt-3 space-y-2">
              {data?.citations.slice(0, 30).map((citation) => (
                <a
                  key={citation.id}
                  className="block truncate text-sm link link-hover"
                  href={citation.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  {citation.isTrackedDomain ? "✓ " : ""}
                  {citation.title ?? citation.domain}
                </a>
              ))}
              {data?.citations.length === 0 ? (
                <p className="text-sm text-base-content/60">
                  Sources appear here after the first completed run.
                </p>
              ) : null}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-base-300 bg-base-100 p-4 shadow-sm">
      <p className="text-sm text-base-content/65">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
    </div>
  );
}
