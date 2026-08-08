import { buildCsv, downloadCsv, type CsvValue } from "@/client/lib/csv";
import { exportTableToSheets } from "@/client/lib/exportToSheets";
import { captureClientEvent } from "@/client/lib/posthog";
import {
  CITATION_PROVIDER_LABELS,
  isCitationProvider,
  type CitationProvider,
} from "@/shared/ai-citation-providers";

export type ExportPrompt = {
  id: string;
  label: string;
  prompt: string;
  tags: { name: string }[];
};

export type ExportCell = {
  promptId: string;
  provider: string;
  model: string;
  brandMentioned: boolean;
  errorMessage: string | null;
  citationCount: number;
  trackedCitationCount: number;
};

const HEADERS = [
  "Prompt",
  "Tags",
  "Assistant",
  "Model",
  "Outcome",
  "Your citations",
  "All citations",
  "Error",
  "Prompt text",
];

function providerLabel(provider: string): string {
  return isCitationProvider(provider)
    ? CITATION_PROVIDER_LABELS[provider]
    : provider;
}

/** The same states the matrix renders, spelled out for a spreadsheet. */
function outcome(cell: ExportCell | undefined): string {
  if (!cell) return "not run";
  if (cell.errorMessage) return "error";
  if (cell.trackedCitationCount > 0) return "cited you";
  if (cell.brandMentioned) return "mentioned only";
  // Distinct from "no mention": an answer that cited nothing is not evidence
  // of absence, and filtering on it is how you find the rows to discount.
  if (cell.citationCount === 0) return "cited nothing";
  return "no mention";
}

/**
 * One row per prompt x provider, including pairs that never ran — a gap is
 * itself evidence, and omitting it would make a partial run look complete.
 * Mirrors the on-screen matrix, filters included.
 */
export function buildCitationExportRows(
  prompts: readonly ExportPrompt[],
  providers: readonly CitationProvider[],
  cells: readonly ExportCell[],
): CsvValue[][] {
  const byKey = new Map(
    cells.map((cell) => [`${cell.promptId}:${cell.provider}`, cell]),
  );
  return prompts.flatMap((prompt) =>
    providers.map((provider) => {
      const cell = byKey.get(`${prompt.id}:${provider}`);
      return [
        prompt.label,
        prompt.tags.map((tag) => tag.name).join(", "),
        providerLabel(provider),
        cell?.model ?? "",
        outcome(cell),
        cell?.trackedCitationCount ?? "",
        cell?.citationCount ?? "",
        cell?.errorMessage ?? "",
        prompt.prompt,
      ];
    }),
  );
}

export function exportCitationMatrix(
  prompts: readonly ExportPrompt[],
  providers: readonly CitationProvider[],
  cells: readonly ExportCell[],
  target: "csv" | "sheets",
): void {
  const rows = buildCitationExportRows(prompts, providers, cells);
  if (target === "csv") {
    downloadCsv("ai-citation-tracking.csv", buildCsv(HEADERS, rows));
    captureClientEvent("data:export", {
      source_feature: "ai-citation-tracking",
      result_count: rows.length,
    });
    return;
  }
  // exportTableToSheets captures its own analytics event.
  void exportTableToSheets({
    headers: HEADERS,
    rows,
    feature: "ai-citation-tracking",
  });
}
