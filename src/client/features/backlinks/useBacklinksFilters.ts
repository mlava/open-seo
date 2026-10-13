import { useCallback, useMemo, useState } from "react";
import { MAX_DATAFORSEO_FILTER_CONDITIONS } from "@/types/schemas/domain";
import {
  EMPTY_BACKLINKS_FILTERS,
  EMPTY_REFERRING_DOMAINS_FILTERS,
  EMPTY_TOP_PAGES_FILTERS,
  countActiveFilters,
  countFilterConditions,
  type BacklinksTabFilterValues,
  type ReferringDomainsFilterValues,
  type TopPagesFilterValues,
} from "./backlinksFilterTypes";

const STORAGE_KEY_PREFIX = "backlinks-filters:";

type FilterValues = Record<string, string>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function loadFromStorage<T extends FilterValues>(
  storageKey: string,
  fallback: T,
): T {
  const fallbackClone = { ...fallback };

  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return fallbackClone;

    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return fallbackClone;

    const result = { ...fallbackClone };
    for (const key in fallback) {
      const value = parsed[key];
      if (typeof value === "string") {
        Object.assign(result, { [key]: value });
      }
    }

    // Filters persisted before the server-side-filtering change had no
    // condition budget; values over the DataForSEO cap would fail every
    // query on load, so start fresh instead.
    if (countFilterConditions(result) > MAX_DATAFORSEO_FILTER_CONDITIONS) {
      return fallbackClone;
    }

    return result;
  } catch {
    return fallbackClone;
  }
}

function saveToStorage(key: string, values: FilterValues) {
  try {
    localStorage.setItem(key, JSON.stringify(values));
  } catch {
    // storage full - silently ignore
  }
}

/**
 * Holds the *applied* filters for one tab. Draft edits live inside the filter
 * panel; values here are what the server queries use, persisted per target
 * and tab so one site's spam exclusions don't leak into another's view.
 *
 * Loaded values are cached per storage key in state (not reloaded via an
 * effect) so switching target never renders — and never bills a fetch for —
 * the previous target's filters.
 */
function useTabFilters<T extends FilterValues>(
  storageKey: string,
  emptyValues: T,
) {
  const [loaded, setLoaded] = useState<Record<string, T>>({});
  const values = useMemo(
    () => loaded[storageKey] ?? loadFromStorage(storageKey, emptyValues),
    [emptyValues, loaded, storageKey],
  );

  const apply = useCallback(
    (next: T) => {
      setLoaded((current) => ({ ...current, [storageKey]: next }));
      saveToStorage(storageKey, next);
    },
    [storageKey],
  );

  const reset = useCallback(() => {
    apply({ ...emptyValues });
  }, [apply, emptyValues]);

  return {
    values,
    apply,
    reset,
    activeFilterCount: countActiveFilters(values),
  };
}

export function useBacklinksFilters(target: string) {
  const [showFilters, setShowFilters] = useState(false);
  const keyPrefix = `${STORAGE_KEY_PREFIX}${target.trim().toLowerCase()}:`;

  const backlinks = useTabFilters<BacklinksTabFilterValues>(
    `${keyPrefix}backlinks`,
    EMPTY_BACKLINKS_FILTERS,
  );
  const domains = useTabFilters<ReferringDomainsFilterValues>(
    `${keyPrefix}domains`,
    EMPTY_REFERRING_DOMAINS_FILTERS,
  );
  const pages = useTabFilters<TopPagesFilterValues>(
    `${keyPrefix}pages`,
    EMPTY_TOP_PAGES_FILTERS,
  );

  return {
    backlinks,
    domains,
    pages,
    showFilters,
    setShowFilters,
  };
}

export type BacklinksFiltersState = ReturnType<typeof useBacklinksFilters>;
