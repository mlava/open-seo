/**
 * Shared by Prompt Explorer and AI Citation Tracking so the two AI tabs agree
 * on what "the brand was mentioned" means.
 */
function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function mentionRegex(brand: string): RegExp {
  // Case-insensitive match on the brand string with word-boundary guards only
  // on sides that end in a word char — otherwise \b fails for brands like
  // "C++" or "AT&T" where the terminal char is non-word. When a boundary char
  // is non-word we guard with a negative lookaround against that same char so
  // "C++" doesn't match "C+++".
  const escaped = escapeRegex(brand);
  const firstEscaped = escapeRegex(brand[0]);
  const lastEscaped = escapeRegex(brand[brand.length - 1]);
  const leading = /^\w/.test(brand) ? "\\b" : `(?<!${firstEscaped})`;
  const trailing = /\w$/.test(brand) ? "\\b" : `(?!${lastEscaped})`;
  return new RegExp(`${leading}${escaped}${trailing}`, "i");
}

/**
 * Aliases are entered as domains ("scholarsidekick.com"), but assistants write
 * prose ("Scholar Sidekick is…"). Track both the domain and its leading label
 * so a plain-prose mention still registers.
 */
export function deriveBrandTerms(aliases: readonly string[]): string[] {
  const terms = new Set<string>();
  for (const alias of aliases) {
    const trimmed = alias.trim();
    if (!trimmed) continue;
    terms.add(trimmed);
    const [label] = trimmed.split(".");
    // Single-character labels match far too much prose to be useful.
    if (label && label !== trimmed && label.length > 2) terms.add(label);
  }
  return [...terms];
}

export function textMentionsBrand(
  text: string,
  terms: readonly string[],
): boolean {
  return terms.some((term) => mentionRegex(term).test(text));
}
