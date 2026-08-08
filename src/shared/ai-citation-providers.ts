/**
 * The AI assistants we ask tracked prompts against. Slugs match the `@ai-sdk/*`
 * package names so the server-side switch reads unambiguously; the labels are
 * the product names a user recognises.
 *
 * Distinct from Prompt Explorer's `PromptExplorerModel` on purpose: that enum
 * is DataForSEO's model catalogue, this one is "providers we hold a key for".
 */
/**
 * Two kinds of surface, one catalogue. The first five are assistants we call
 * with our own key. The last three are AI answers rendered on a search results
 * page, which have no first-party API at all — Bing's Search APIs are retired
 * and Google publishes none — so they are read through SerpApi. Listed after
 * the assistants because `sortCitationProviders` fixes column order from here.
 */
export const CITATION_PROVIDERS = [
  "openai",
  "anthropic",
  "google",
  "perplexity",
  "xai",
  "google_ai_overview",
  "google_ai_mode",
  "bing_copilot",
] as const;

/** Engines reached via SerpApi rather than the provider's own API. */
export const SERPAPI_PROVIDERS = [
  "google_ai_overview",
  "google_ai_mode",
  "bing_copilot",
] as const satisfies readonly CitationProvider[];

/** Takes a bare string: stored rows carry the slug untyped. */
export function isSerpApiProvider(provider: string): boolean {
  return (SERPAPI_PROVIDERS as readonly string[]).includes(provider);
}

export type CitationProvider = (typeof CITATION_PROVIDERS)[number];

export const CITATION_PROVIDER_LABELS: Record<CitationProvider, string> = {
  openai: "ChatGPT",
  anthropic: "Claude",
  google: "Gemini",
  perplexity: "Perplexity",
  xai: "Grok",
  google_ai_overview: "Google AI Overview",
  google_ai_mode: "Google AI Mode",
  bing_copilot: "Bing Copilot",
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
  // Search surfaces take hues not already spoken for by an assistant — sky is
  // Gemini's, so the two Google surfaces sit either side of it rather than on it.
  google_ai_overview: "bg-blue-600",
  google_ai_mode: "bg-indigo-500",
  bing_copilot: "bg-teal-500",
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
