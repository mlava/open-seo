import {
  CITATION_PROVIDER_DOT_CLASS,
  CITATION_PROVIDER_LABELS,
  type CitationProvider,
} from "@/shared/ai-citation-providers";

/** Tiles and panel states, matching the Revenue and PageSpeed tabs. */
export function StatTile({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-base-300 bg-base-100 p-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-base-content/55">
        {label}
      </p>
      <span className="mt-1 block text-2xl font-semibold tabular-nums">
        {value}
      </span>
      {hint ? (
        <p className="mt-1 text-xs text-base-content/50">{hint}</p>
      ) : null}
    </div>
  );
}

export function PanelLoading({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-base-content/50">
      <span className="loading loading-spinner loading-sm" />
      {label}
    </div>
  );
}

export function PanelError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-error">Couldn't load this panel.</p>
      <button type="button" className="btn btn-ghost btn-sm" onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}

export function ProviderBadge({
  provider,
  className = "",
}: {
  provider: CitationProvider;
  className?: string;
}) {
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <span
        className={`inline-block size-2 shrink-0 rounded-full ${CITATION_PROVIDER_DOT_CLASS[provider]}`}
      />
      {CITATION_PROVIDER_LABELS[provider]}
    </span>
  );
}
