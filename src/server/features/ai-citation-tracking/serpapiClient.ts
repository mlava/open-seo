import type { CitationSource } from "./citationClient";

/**
 * SerpApi reads AI answers rendered on a search results page — Google's AI
 * Overview and AI Mode, and Bing Copilot. None has a first-party API: Bing's
 * Search APIs are retired and Google publishes none, so scraping via SerpApi is
 * the only route. This is not the "measuring the aggregator" trap that rules
 * OpenRouter out for the assistants — there is no first-party answer to prefer,
 * and what SerpApi returns is the answer a searcher actually sees.
 */

const SERPAPI_URL = "https://serpapi.com/search.json";
/** Long enough for an AI answer to generate, short enough not to eat the step. */
const REQUEST_TIMEOUT_MS = 60_000;

export type SerpApiAnswer = {
  answerText: string;
  sources: CitationSource[];
};

/**
 * Narrower than `typeof fetch`: this module only ever calls a URL with an
 * abort signal, and the Workers `fetch` overloads are painful to satisfy from
 * a test double.
 */
export type SerpApiFetch = (
  url: URL,
  init: { signal: AbortSignal },
) => Promise<Response>;

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null) return {};
  return Object.fromEntries(Object.entries(value));
}

/**
 * Flatten SerpApi's nested text_blocks into plain text. Blocks nest: a `list`
 * carries `list[]`, an `expandable` carries its own `text_blocks[]`, and only
 * the leaves hold `snippet`.
 */
export function flattenTextBlocks(blocks: unknown, depth = 0): string[] {
  if (!Array.isArray(blocks) || depth > 8) return [];
  const out: string[] = [];
  for (const entry of blocks) {
    const block = asRecord(entry);
    if (typeof block.snippet === "string" && block.snippet.trim())
      out.push(block.snippet.trim());
    if (typeof block.title === "string" && block.title.trim())
      out.push(block.title.trim());
    out.push(...flattenTextBlocks(block.list, depth + 1));
    out.push(...flattenTextBlocks(block.text_blocks, depth + 1));
  }
  return out;
}

/**
 * All three engines answer with the same `text_blocks[]` / `references[]` pair.
 * The Google engine nests them under `ai_overview`; AI Mode and Copilot put
 * them at the top level.
 */
export function parseSerpApiAnswer(payload: unknown): SerpApiAnswer {
  const root = asRecord(payload);
  const container = asRecord(root.ai_overview ?? root);

  const parts = flattenTextBlocks(container.text_blocks);
  if (parts.length === 0) {
    // Some engines return a plain answer string instead of blocks.
    for (const key of ["markdown", "answer", "header"]) {
      const value = container[key];
      if (typeof value === "string" && value.trim()) parts.push(value.trim());
    }
  }

  const seen = new Map<string, CitationSource>();
  const references = Array.isArray(container.references)
    ? container.references
    : [];
  for (const entry of references) {
    const reference = asRecord(entry);
    const url = reference.link;
    if (typeof url !== "string" || seen.has(url)) continue;
    const title =
      typeof reference.title === "string"
        ? reference.title
        : typeof reference.source === "string"
          ? reference.source
          : null;
    seen.set(url, { url, title });
  }

  return { answerText: parts.join("\n\n"), sources: [...seen.values()] };
}

async function serpApiRequest(
  apiKey: string,
  params: Record<string, string>,
  fetchImpl: SerpApiFetch,
): Promise<unknown> {
  const url = new URL(SERPAPI_URL);
  for (const [key, value] of Object.entries(params))
    url.searchParams.set(key, value);
  url.searchParams.set("api_key", apiKey);

  // A timeout REJECTS rather than resolving, so it must be allowed to
  // propagate to the caller's try/catch and be recorded as a failed cell.
  const response = await fetchImpl(url, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const payload: unknown = await response.json().catch(() => ({}));
  const error = asRecord(payload).error;
  if (!response.ok || typeof error === "string") {
    throw new Error(
      typeof error === "string"
        ? error
        : `SerpApi request failed (${response.status})`,
    );
  }
  return payload;
}

/**
 * Google's AI Overview arrives with the ordinary search result, but often only
 * as a `page_token` that must be redeemed against the dedicated engine.
 * That token expires about a minute after the search, so the follow-up runs
 * immediately rather than being deferred to another step.
 */
export async function fetchAiOverview(
  apiKey: string,
  query: string,
  fetchImpl: SerpApiFetch = fetch,
): Promise<SerpApiAnswer> {
  const search = asRecord(
    await serpApiRequest(
      apiKey,
      { engine: "google", q: query, hl: "en", gl: "us" },
      fetchImpl,
    ),
  );
  const overview = asRecord(search.ai_overview);
  const pageToken = overview.page_token;

  if (typeof pageToken === "string") {
    return parseSerpApiAnswer(
      await serpApiRequest(
        apiKey,
        { engine: "google_ai_overview", page_token: pageToken },
        fetchImpl,
      ),
    );
  }
  // No AI Overview for this query is a real result, not an error: it means
  // Google chose not to show one, which is itself worth recording.
  return parseSerpApiAnswer(search);
}

export async function fetchSerpApiEngine(
  apiKey: string,
  engine: "google_ai_mode" | "bing_copilot",
  query: string,
  fetchImpl: SerpApiFetch = fetch,
): Promise<SerpApiAnswer> {
  const params: Record<string, string> =
    engine === "google_ai_mode"
      ? { engine, q: query, hl: "en", gl: "us" }
      : { engine, q: query };
  return parseSerpApiAnswer(await serpApiRequest(apiKey, params, fetchImpl));
}
