/**
 * Small pure helpers shared by the tracker service and its run executor.
 * Deliberately free of `@/db` imports: that module statically imports
 * `cloudflare:workers`, which cannot load in the node test environment, so
 * anything importable by a unit test has to live here.
 */
import {
  parseCitationProviders,
  sortCitationProviders,
  type CitationProvider,
} from "@/shared/ai-citation-providers";

export function parseAliases(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

export function normalizeAliases(aliases: string[]): string[] {
  return [...new Set(aliases.map((alias) => alias.trim()).filter(Boolean))];
}

/** Registrable host for a URL, or null when the value isn't a URL at all. */
export function safeDomain(value: string): string | null {
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

/**
 * Aliases are entered bare ("example.com"), so give them a scheme before
 * parsing — `new URL("example.com")` throws rather than yielding a hostname.
 */
export function aliasDomain(alias: string): string | null {
  return safeDomain(`https://${alias.trim().replace(/^https?:\/\//, "")}`);
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export function nextWeeklyRun(now = new Date()): string {
  return new Date(now.getTime() + WEEK_MS).toISOString();
}

/**
 * Which providers a prompt runs against: its own override when set, otherwise
 * the project default. Either way it is bounded by the providers this instance
 * holds a key for, so a revoked key degrades the run instead of failing it.
 */
export function providersForPrompt(
  prompt: { providers: string | null },
  projectDefault: CitationProvider[],
  configured: readonly CitationProvider[],
): CitationProvider[] {
  const chosen = prompt.providers
    ? parseCitationProviders(prompt.providers)
    : projectDefault;
  return sortCitationProviders(
    chosen.filter((provider) => configured.includes(provider)),
  );
}

/**
 * Citations kept per answer. Each becomes its own statement in the response's
 * atomic batch, so this bounds the batch rather than any one statement. Answers
 * citing more than this are rare and the tail adds little evidence.
 */
export const MAX_CITATIONS_PER_RESPONSE = 60;

/**
 * Turn an answer's sources into citation rows. Sources that aren't parseable
 * URLs are dropped rather than stored with a null domain, since domain is what
 * every rollup groups by. `citationOrder` reflects the order the assistant
 * cited them in.
 */
export function buildCitationRows(
  sources: readonly { url: string; title: string | null }[],
  context: {
    responseId: string;
    projectId: string;
    trackedDomains: Set<string>;
  },
) {
  return sources
    .slice(0, MAX_CITATIONS_PER_RESPONSE)
    .flatMap((source, citationOrder) => {
      const domain = safeDomain(source.url);
      return domain
        ? [
            {
              id: crypto.randomUUID(),
              responseId: context.responseId,
              projectId: context.projectId,
              url: source.url,
              domain,
              title: source.title,
              citationOrder,
              isTrackedDomain: context.trackedDomains.has(domain),
            },
          ]
        : [];
    });
}
