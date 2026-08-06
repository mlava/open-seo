import { generateText } from "ai";
import { getOptionalEnvValue } from "@/server/lib/runtime-env";
import {
  CITATION_PROVIDERS,
  type CitationProvider,
} from "@/shared/ai-citation-providers";

export class CitationProviderNotConfiguredError extends Error {
  constructor(provider: CitationProvider) {
    super(`No API key configured for ${provider}`);
    this.name = "CitationProviderNotConfiguredError";
  }
}

export type CitationSource = { url: string; title: string | null };

/**
 * The subset of a `generateText` result this module reads. Structural rather
 * than `GenerateTextResult<ToolSet, never>`: naming that type as the return of
 * the provider switch pushes its `never` output parameter back into each
 * branch's `tools`, and every provider's web-search tool then fails to typecheck.
 */
type ProviderCallResult = {
  text: string;
  sources: readonly { sourceType: string; url?: string; title?: string }[];
  staticToolResults?: readonly { output?: unknown }[];
  usage: { inputTokens?: number; outputTokens?: number };
  response: { modelId: string };
};

export type CitationRunResult = {
  model: string;
  answerText: string;
  sources: CitationSource[];
  inputTokens: number | null;
  outputTokens: number | null;
};

/**
 * Each provider's key is an instance-wide Worker secret, not per-project: the
 * tracker spends the operator's own API budget rather than resold credits.
 */
const PROVIDER_ENV: Record<
  CitationProvider,
  { apiKey: string; model: string; defaultModel: string }
> = {
  openai: {
    apiKey: "OPENAI_API_KEY",
    model: "AI_CITATION_MODEL_OPENAI",
    defaultModel: "gpt-5",
  },
  anthropic: {
    apiKey: "ANTHROPIC_API_KEY",
    model: "AI_CITATION_MODEL_ANTHROPIC",
    defaultModel: "claude-sonnet-4-5",
  },
  google: {
    apiKey: "GOOGLE_GENERATIVE_AI_API_KEY",
    model: "AI_CITATION_MODEL_GOOGLE",
    // gemini-2.5-pro is closed to new API keys. Flash rather than flash-lite:
    // grounded search quality is the whole product here.
    defaultModel: "gemini-3.5-flash",
  },
  perplexity: {
    apiKey: "PERPLEXITY_API_KEY",
    model: "AI_CITATION_MODEL_PERPLEXITY",
    defaultModel: "sonar-pro",
  },
  xai: {
    apiKey: "XAI_API_KEY",
    model: "AI_CITATION_MODEL_XAI",
    defaultModel: "grok-4",
  },
};

export async function hasCitationProviderKey(
  provider: CitationProvider,
): Promise<boolean> {
  return Boolean(await getOptionalEnvValue(PROVIDER_ENV[provider].apiKey));
}

/** The providers this instance actually holds a key for. */
export async function getConfiguredCitationProviders(): Promise<
  CitationProvider[]
> {
  const configured = await Promise.all(
    CITATION_PROVIDERS.map(async (provider) =>
      (await hasCitationProviderKey(provider)) ? provider : null,
    ),
  );
  return configured.filter((provider): provider is CitationProvider =>
    Boolean(provider),
  );
}

export function citationProviderKeyEnvName(provider: CitationProvider): string {
  return PROVIDER_ENV[provider].apiKey;
}

export async function runCitationPrompt(
  provider: CitationProvider,
  prompt: string,
): Promise<CitationRunResult> {
  const spec = PROVIDER_ENV[provider];
  const apiKey = await getOptionalEnvValue(spec.apiKey);
  if (!apiKey) throw new CitationProviderNotConfiguredError(provider);
  const modelId = (await getOptionalEnvValue(spec.model)) ?? spec.defaultModel;

  const result = await callProvider(provider, apiKey, modelId, prompt);
  const sources =
    provider === "google"
      ? await resolveGroundingRedirects(extractSources(result))
      : extractSources(result);

  return {
    model: result.response.modelId || modelId,
    answerText: result.text,
    sources,
    inputTokens: result.usage.inputTokens ?? null,
    outputTokens: result.usage.outputTokens ?? null,
  };
}

/**
 * One `generateText` per provider rather than a shared options object: each
 * provider's web-search tool is its own type, and a union would need a cast to
 * satisfy `generateText`. Native search is the point — an aggregator's search
 * would measure the aggregator, not the assistant.
 *
 * Every provider SDK is imported dynamically. These packages are on the lean
 * worker bundle's eager denylist: a static import would pull all five into the
 * isolate's startup graph even though a given call needs exactly one.
 */
async function callProvider(
  provider: CitationProvider,
  apiKey: string,
  modelId: string,
  prompt: string,
): Promise<ProviderCallResult> {
  switch (provider) {
    case "openai": {
      const { createOpenAI } = await import("@ai-sdk/openai");
      const openai = createOpenAI({ apiKey });
      return generateText({
        model: openai.responses(modelId),
        tools: { web_search: openai.tools.webSearch({}) },
        prompt,
      });
    }
    case "anthropic": {
      const { createAnthropic } = await import("@ai-sdk/anthropic");
      const anthropic = createAnthropic({ apiKey });
      return generateText({
        model: anthropic(modelId),
        tools: { web_search: anthropic.tools.webSearch_20250305({}) },
        prompt,
      });
    }
    case "google": {
      const { createGoogleGenerativeAI } = await import("@ai-sdk/google");
      const google = createGoogleGenerativeAI({ apiKey });
      return generateText({
        model: google(modelId),
        tools: { google_search: google.tools.googleSearch({}) },
        prompt,
      });
    }
    case "perplexity": {
      // Perplexity searches on every request; it exposes no search tool.
      const { createPerplexity } = await import("@ai-sdk/perplexity");
      const perplexity = createPerplexity({ apiKey });
      return generateText({ model: perplexity(modelId), prompt });
    }
    case "xai": {
      const { createXai } = await import("@ai-sdk/xai");
      const xai = createXai({ apiKey });
      return generateText({
        model: xai(modelId),
        tools: { web_search: xai.tools.webSearch({}) },
        prompt,
      });
    }
  }
}

/**
 * Prefer the SDK's normalised `sources`. xAI reports its hits in the
 * web_search tool output instead, so fall back to that shape before concluding
 * a provider returned nothing.
 */
export function extractSources(
  result: Pick<ProviderCallResult, "sources" | "staticToolResults">,
): CitationSource[] {
  const found = new Map<string, CitationSource>();
  // First mention of a URL wins its position; a later duplicate only fills in a
  // title the first one lacked. Providers often list a source bare during
  // search and again with a title when they cite it.
  const add = (url: string, title: string | null) => {
    const existing = found.get(url);
    if (!existing) {
      found.set(url, { url, title });
      return;
    }
    if (!existing.title && title) existing.title = title;
  };

  for (const source of result.sources) {
    if (source.sourceType !== "url" || !source.url) continue;
    add(source.url, source.title ?? null);
  }
  if (found.size > 0) return [...found.values()];

  for (const toolResult of result.staticToolResults ?? []) {
    for (const source of toolOutputSources(toolResult.output)) {
      add(source.url, source.title);
    }
  }
  return [...found.values()];
}

/** Read `{ sources: [{ url, title }] }` out of a provider-executed tool result. */
function toolOutputSources(output: unknown): CitationSource[] {
  if (typeof output !== "object" || output === null) return [];
  const sources: unknown = Reflect.get(output, "sources");
  if (!Array.isArray(sources)) return [];
  const found: CitationSource[] = [];
  for (const entry of sources) {
    if (typeof entry !== "object" || entry === null) continue;
    const url: unknown = Reflect.get(entry, "url");
    if (typeof url !== "string") continue;
    const title: unknown = Reflect.get(entry, "title");
    found.push({ url, title: typeof title === "string" ? title : null });
  }
  return found;
}

const GROUNDING_REDIRECT_HOST = "vertexaisearch.cloud.google.com";
/** Bounded so one chatty answer cannot turn into 100 outbound requests. */
const MAX_REDIRECTS_RESOLVED = 25;

export function isGroundingRedirect(url: string): boolean {
  try {
    return new URL(url).hostname === GROUNDING_REDIRECT_HOST;
  } catch {
    return false;
  }
}

/**
 * Gemini returns grounding links as `vertexaisearch.cloud.google.com`
 * redirects, so every citation would otherwise record that one host and never
 * match a tracked domain. Resolve to the destination; when resolution fails,
 * Gemini's title is the site domain, which is enough to attribute the source.
 */
export async function resolveGroundingRedirects(
  sources: CitationSource[],
  fetchImpl: typeof fetch = fetch,
): Promise<CitationSource[]> {
  let budget = MAX_REDIRECTS_RESOLVED;
  return Promise.all(
    sources.map(async (source) => {
      if (!isGroundingRedirect(source.url) || budget <= 0) return source;
      budget -= 1;
      try {
        const response = await fetchImpl(source.url, { redirect: "manual" });
        const location = response.headers.get("location");
        return location ? { ...source, url: location } : source;
      } catch {
        return source;
      }
    }),
  );
}
