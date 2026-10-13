import { AppError } from "@/server/lib/errors";
import { MAX_DATAFORSEO_FILTER_CONDITIONS } from "@/types/schemas/domain";

/**
 * Building blocks for DataForSEO `filters` expressions, shared by the
 * feature-specific builders (domain keywords, backlinks). A "clause" is one
 * condition tuple like ["field", "ilike", "%term%"] or a nested group.
 */
export type FilterClause = unknown[];

export function escapeLikeTerm(term: string): string {
  return term.replace(/[\\%_]/g, (match) => `\\${match}`);
}

/** DataForSEO caps `regex` / `not_regex` pattern values at 1000 characters. */
export const MAX_DATAFORSEO_REGEX_LENGTH = 1000;

function escapeRegexTerm(term: string): string {
  return term.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}

/**
 * All exclude terms as ONE condition so the number of excluded sites is not
 * bounded by the 8-condition request budget. A single term keeps the plain
 * `not_ilike`; several collapse into one case-insensitive RE2 alternation
 * (`not_regex`). Returns null when there are no terms.
 */
export function buildExcludeClause(
  field: string,
  exclude: string | undefined,
): FilterClause | null {
  const terms = parseFilterTerms(exclude);
  const first = terms[0];
  if (first === undefined) return null;
  if (terms.length === 1) {
    return [field, "not_ilike", `%${escapeLikeTerm(first)}%`];
  }
  const pattern = `(?i)${terms.map(escapeRegexTerm).join("|")}`;
  if (pattern.length > MAX_DATAFORSEO_REGEX_LENGTH) {
    throw new AppError(
      "VALIDATION_ERROR",
      `Exclude terms are too long (${pattern.length} of ${MAX_DATAFORSEO_REGEX_LENGTH} characters max). Remove some terms.`,
    );
  }
  return [field, "not_regex", pattern];
}

/** Splits a comma/plus separated terms string into trimmed lowercase terms. */
export function parseFilterTerms(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .toLowerCase()
    .split(/[,+]/)
    .map((term) => term.trim())
    .filter(Boolean);
}

export function collectNumericRange(
  out: FilterClause[],
  field: string,
  min: number | undefined,
  max: number | undefined,
) {
  if (typeof min === "number" && Number.isFinite(min)) {
    out.push([field, ">=", min]);
  }
  if (typeof max === "number" && Number.isFinite(max)) {
    out.push([field, "<=", max]);
  }
}

/**
 * One ilike condition per include term, joined with "or" into a single nested
 * group (match-any semantics). Returns the group clause plus how many of the
 * DataForSEO condition budget it consumes.
 */
export function buildIncludeOrGroup(
  field: string,
  include: string | undefined,
): { clause: FilterClause; conditionCount: number } | null {
  const conditions = parseFilterTerms(include).map((term) => [
    field,
    "ilike",
    `%${escapeLikeTerm(term)}%`,
  ]);
  if (conditions.length === 0) return null;
  const first = conditions[0];
  if (conditions.length === 1 && first) {
    return { clause: first, conditionCount: 1 };
  }
  return {
    clause: joinClauses(conditions, "or"),
    conditionCount: conditions.length,
  };
}

/**
 * DataForSEO accepts up to 8 filter conditions per request. The clients
 * surface the same condition count and disable Apply when over budget, so
 * reaching the cap here indicates a misbehaving client — we throw rather
 * than silently truncate.
 */
export function assertFilterConditionBudget(conditionCount: number): void {
  if (conditionCount > MAX_DATAFORSEO_FILTER_CONDITIONS) {
    throw new AppError(
      "VALIDATION_ERROR",
      `Too many filter conditions (${conditionCount} of ${MAX_DATAFORSEO_FILTER_CONDITIONS} max).`,
    );
  }
}

export function joinClauses(
  clauses: FilterClause[],
  operator: "and" | "or",
): unknown[] {
  const expressions: unknown[] = [];
  for (const clause of clauses) {
    if (expressions.length > 0) expressions.push(operator);
    expressions.push(clause);
  }
  return expressions;
}
