import { useQuery } from "@tanstack/react-query";
import { Modal } from "@/client/components/Modal";
import { Markdown } from "@/client/components/Markdown";
import { getAiCitationTrackingResponse } from "@/serverFunctions/ai-citation-tracking";
import { isCitationProvider } from "@/shared/ai-citation-providers";
import { PanelError, PanelLoading, ProviderBadge } from "./citationParts";

/** The drill-in behind a matrix cell: what the assistant actually answered. */
export function CitationResponseModal({
  projectId,
  responseId,
  promptLabel,
  onClose,
}: {
  projectId: string;
  responseId: string;
  promptLabel: string;
  onClose: () => void;
}) {
  const query = useQuery({
    queryKey: ["aiCitationTrackingResponse", projectId, responseId],
    queryFn: () =>
      getAiCitationTrackingResponse({ data: { projectId, responseId } }),
  });
  const data = query.data;
  const provider = data?.response.provider;

  return (
    <Modal
      maxWidth="max-w-3xl"
      onClose={onClose}
      labelledBy="citation-response"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="citation-response" className="font-semibold">
            {promptLabel}
          </h2>
          {data ? (
            <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-base-content/60">
              {provider && isCitationProvider(provider) ? (
                <ProviderBadge provider={provider} />
              ) : (
                provider
              )}
              <span className="font-mono text-xs">{data.response.model}</span>
              <span>{new Date(data.response.createdAt).toLocaleString()}</span>
            </p>
          ) : null}
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={onClose}
        >
          Close
        </button>
      </div>

      {query.isLoading ? (
        <PanelLoading label="Loading answer…" />
      ) : query.isError ? (
        <PanelError onRetry={() => void query.refetch()} />
      ) : data ? (
        <>
          {data.response.errorMessage ? (
            <div className="alert alert-error">
              <span className="text-sm">{data.response.errorMessage}</span>
            </div>
          ) : (
            <div className="max-h-96 overflow-y-auto rounded-lg bg-base-200 p-3 text-sm">
              <Markdown>{data.response.answerText ?? ""}</Markdown>
            </div>
          )}

          <div>
            <h3 className="text-sm font-semibold">
              Cited sources ({data.citations.length})
            </h3>
            <ul className="mt-2 space-y-1">
              {data.citations.map((citation) => (
                <li key={citation.id} className="text-sm">
                  <a
                    className="link link-hover inline-flex max-w-full items-baseline gap-1.5"
                    href={citation.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {citation.isTrackedDomain ? (
                      <span className="text-success" title="Tracked domain">
                        ✓
                      </span>
                    ) : null}
                    <span className="truncate">
                      {citation.title || citation.url}
                    </span>
                    <span className="shrink-0 text-xs text-base-content/50">
                      {citation.domain}
                    </span>
                  </a>
                </li>
              ))}
              {data.citations.length === 0 ? (
                <li className="text-sm text-base-content/60">
                  This answer cited no sources.
                </li>
              ) : null}
            </ul>
          </div>
        </>
      ) : null}
    </Modal>
  );
}
