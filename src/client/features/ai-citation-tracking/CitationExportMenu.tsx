import { TableExportMenu } from "@/client/components/table/TableBulkActionBar";
import type { CitationProvider } from "@/shared/ai-citation-providers";
import {
  exportCitationMatrix,
  type ExportCell,
  type ExportPrompt,
} from "./export";

/**
 * Exports the matrix as it is currently filtered, one row per prompt and
 * assistant, so a tag filter narrows the export the same way it narrows the
 * table.
 */
export function CitationExportMenu({
  prompts,
  providers,
  cells,
}: {
  prompts: readonly ExportPrompt[];
  providers: readonly CitationProvider[];
  cells: readonly ExportCell[];
}) {
  if (prompts.length === 0 || providers.length === 0) return null;
  return (
    <TableExportMenu
      // shrink-0: the run picker beside this is w-full, and without it the
      // flex row would compress the button instead of the select.
      buttonClassName="btn btn-ghost btn-sm shrink-0 gap-1"
      actions={[
        {
          label: "Export to Sheets",
          onClick: () =>
            exportCitationMatrix(prompts, providers, cells, "sheets"),
        },
        {
          label: "Download CSV",
          onClick: () => exportCitationMatrix(prompts, providers, cells, "csv"),
        },
      ]}
    />
  );
}
