import * as React from "react";
import {
  CITATION_PROVIDER_DOT_CLASS,
  CITATION_PROVIDER_LABELS,
  type CitationProvider,
} from "@/shared/ai-citation-providers";

export type MatrixCell = {
  id: string;
  promptId: string;
  provider: string;
  model: string;
  brandMentioned: boolean;
  errorMessage: string | null;
  citationCount: number;
  trackedCitationCount: number;
};

export type MatrixPrompt = {
  id: string;
  label: string;
  tags: { id: string; name: string; color: string | null }[];
};

type CellState = "cited" | "mentioned" | "answered" | "error" | "missing";

function cellState(cell: MatrixCell | undefined): CellState {
  if (!cell) return "missing";
  if (cell.errorMessage) return "error";
  if (cell.trackedCitationCount > 0) return "cited";
  if (cell.brandMentioned) return "mentioned";
  return "answered";
}

const STATE_GLYPH: Record<CellState, string> = {
  cited: "✓",
  mentioned: "◐",
  answered: "—",
  error: "!",
  missing: "·",
};

const STATE_CLASS: Record<CellState, string> = {
  cited: "bg-success/15 text-success",
  mentioned: "bg-warning/15 text-warning",
  answered: "text-base-content/40",
  error: "bg-error/10 text-error",
  missing: "text-base-content/25",
};

const STATE_TITLE: Record<CellState, string> = {
  cited: "Cited a tracked domain",
  mentioned: "Mentioned the brand but cited no tracked domain",
  answered: "Answered with no brand mention",
  error: "Provider call failed",
  missing: "Not run for this provider",
};

export function CitationMatrix({
  prompts,
  providers,
  cells,
  onSelectCell,
}: {
  prompts: MatrixPrompt[];
  providers: CitationProvider[];
  cells: MatrixCell[];
  onSelectCell: (cell: MatrixCell) => void;
}) {
  const byKey = React.useMemo(() => {
    const map = new Map<string, MatrixCell>();
    for (const cell of cells)
      map.set(`${cell.promptId}:${cell.provider}`, cell);
    return map;
  }, [cells]);

  if (prompts.length === 0)
    return (
      <p className="text-sm text-base-content/60">
        No prompts match this filter.
      </p>
    );

  return (
    <div className="overflow-x-auto">
      <table className="table table-sm">
        <thead>
          <tr>
            <th className="min-w-56">Prompt</th>
            {providers.map((provider) => (
              <th key={provider} className="text-center">
                <span className="inline-flex items-center gap-1.5">
                  <span
                    className={`inline-block size-2 rounded-full ${CITATION_PROVIDER_DOT_CLASS[provider]}`}
                  />
                  {CITATION_PROVIDER_LABELS[provider]}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {prompts.map((prompt) => (
            <tr key={prompt.id}>
              <td className="max-w-sm">
                <span className="block truncate font-medium">
                  {prompt.label}
                </span>
              </td>
              {providers.map((provider) => {
                const cell = byKey.get(`${prompt.id}:${provider}`);
                const state = cellState(cell);
                const title = cell?.errorMessage
                  ? `${STATE_TITLE.error}: ${cell.errorMessage}`
                  : STATE_TITLE[state];
                return (
                  <td key={provider} className="text-center">
                    {cell ? (
                      <button
                        type="button"
                        title={title}
                        aria-label={`${prompt.label} — ${CITATION_PROVIDER_LABELS[provider]}: ${STATE_TITLE[state]}`}
                        className={`btn btn-ghost btn-xs w-full font-mono ${STATE_CLASS[state]}`}
                        onClick={() => onSelectCell(cell)}
                      >
                        {STATE_GLYPH[state]}
                        {cell.citationCount > 0 ? (
                          <span className="ml-1 text-[10px] opacity-70">
                            {cell.trackedCitationCount}/{cell.citationCount}
                          </span>
                        ) : null}
                      </button>
                    ) : (
                      <span
                        title={STATE_TITLE.missing}
                        className={`font-mono ${STATE_CLASS.missing}`}
                      >
                        {STATE_GLYPH.missing}
                      </span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <MatrixLegend />
    </div>
  );
}

function MatrixLegend() {
  const entries: CellState[] = [
    "cited",
    "mentioned",
    "answered",
    "error",
    "missing",
  ];
  return (
    <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-base-content/55">
      {entries.map((state) => (
        <span key={state} className="inline-flex items-center gap-1.5">
          <span className={`font-mono ${STATE_CLASS[state]}`}>
            {STATE_GLYPH[state]}
          </span>
          {STATE_TITLE[state]}
        </span>
      ))}
      <span>Counts are tracked-domain citations / all citations.</span>
    </p>
  );
}
