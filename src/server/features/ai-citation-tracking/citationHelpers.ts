/** Small shared helpers used by both the tracker service and its run executor. */

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
