/**
 * The AI assistants we ask tracked prompts against. Slugs match the `@ai-sdk/*`
 * package names so the server-side switch reads unambiguously; the labels are
 * the product names a user recognises.
 *
 * Distinct from Prompt Explorer's `PromptExplorerModel` on purpose: that enum
 * is DataForSEO's model catalogue, this one is "providers we hold a key for".
 */
export const CITATION_PROVIDERS = [
  "openai",
  "anthropic",
  "google",
  "perplexity",
  "xai",
] as const;

export type CitationProvider = (typeof CITATION_PROVIDERS)[number];

export const CITATION_PROVIDER_LABELS: Record<CitationProvider, string> = {
  openai: "ChatGPT",
  anthropic: "Claude",
  google: "Gemini",
  perplexity: "Perplexity",
  xai: "Grok",
};

/**
 * Accent dots, deliberately the same hues Prompt Explorer gives the same
 * assistants (see client/features/ai-search/platformLabels.ts) so the two AI
 * tabs read as one system. Grok has no Prompt Explorer equivalent.
 */
export const CITATION_PROVIDER_DOT_CLASS: Record<CitationProvider, string> = {
  openai: "bg-emerald-500",
  anthropic: "bg-orange-500",
  google: "bg-sky-500",
  perplexity: "bg-violet-500",
  xai: "bg-slate-500",
};

export function isCitationProvider(value: unknown): value is CitationProvider {
  return (
    typeof value === "string" &&
    (CITATION_PROVIDERS as readonly string[]).includes(value)
  );
}

/** Keep a provider list in catalogue order, deduped, so UI order is stable. */
export function sortCitationProviders(
  providers: readonly CitationProvider[],
): CitationProvider[] {
  const present = new Set(providers);
  return CITATION_PROVIDERS.filter((provider) => present.has(provider));
}

/**
 * Provider lists are stored as a JSON array of slugs. Unknown slugs are dropped
 * rather than thrown on, so removing a provider from the catalogue can never
 * make an existing project's settings unreadable.
 */
export function parseCitationProviders(value: string): CitationProvider[] {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return sortCitationProviders(parsed.filter(isCitationProvider));
  } catch {
    return [];
  }
}

export function serializeCitationProviders(
  providers: readonly CitationProvider[],
): string {
  return JSON.stringify(sortCitationProviders(providers));
}
