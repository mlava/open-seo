/**
 * Shared by Prompt Explorer and AI Citation Tracking so the two AI tabs agree
 * on what "the brand was mentioned" means.
 */
function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Word separators a brand can be written with: spaces, dots, dashes, underscores. */
const SEPARATORS = /[\s._\-–—]+/;
const SEPARATOR_PATTERN = "[\\s._\\-\\u2013\\u2014]*";

export function mentionRegex(brand: string): RegExp {
  // Assistants write brands as prose ("Scholar Sidekick") while aliases are
  // entered as domains ("scholar-sidekick.com"). Matching the alias literally
  // therefore only ever fired when the answer printed the domain itself — which
  // is when it was already citing — so the signal was redundant with the
  // citation count and never rescued an assistant that mentions you without
  // linking. Multi-token brands now match across any separator, or none.
  const tokens = brand.split(SEPARATORS).filter(Boolean);
  const body =
    tokens.length > 1
      ? tokens.map(escapeRegex).join(SEPARATOR_PATTERN)
      : escapeRegex(brand);

  // Word-boundary guards only on sides that end in a word char — otherwise \b
  // fails for brands like "C++" or "AT&T" where the terminal char is non-word.
  // When a boundary char is non-word we guard with a negative lookaround
  // against that same char so "C++" doesn't match "C+++".
  const first = tokens[0] ?? brand;
  const last = tokens[tokens.length - 1] ?? brand;
  const leading = /^\w/.test(first)
    ? "\\b"
    : `(?<!${escapeRegex(first[0] ?? "")})`;
  const trailing = /\w$/.test(last)
    ? "\\b"
    : `(?!${escapeRegex(last[last.length - 1] ?? "")})`;
  return new RegExp(`${leading}${body}${trailing}`, "i");
}

/**
 * Aliases are entered as domains ("scholar-sidekick.com"), but assistants write
 * prose ("Scholar Sidekick is…"). Track the domain and the registrable label so
 * a plain-prose mention still registers.
 */
export function deriveBrandTerms(aliases: readonly string[]): string[] {
  const terms = new Set<string>();
  for (const alias of aliases) {
    const trimmed = alias.trim().replace(/^www\./i, "");
    if (!trimmed) continue;
    terms.add(trimmed);

    // The registrable label, not the first one: "docs.example.com" is the
    // Example brand, and taking the leftmost label made "docs" a brand term
    // that matched any answer mentioning documentation.
    const parts = trimmed.split(".").filter(Boolean);
    const label = parts.length > 1 ? parts[parts.length - 2] : parts[0];
    // Very short labels match far too much prose to be useful, and this also
    // discards the "co" of a co.uk-style suffix.
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
