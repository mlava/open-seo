import { z } from "zod";

import { getAuth } from "@/lib/auth";
import {
  BING_API_BASE,
  BING_OAUTH_PROVIDER_ID,
  decodeBingAccessToken,
} from "@/shared/bing";

/** A Bing Webmaster REST call returned a non-2xx status, or a 2xx body that
 *  wasn't the expected WCF `d` envelope. `status` drives user-facing messaging;
 *  for a malformed-but-2xx body it carries the HTTP status we actually saw. */
export class BingApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly body?: string,
    /** Bing's own `ErrorCode` from a `{"ErrorCode":n,"Message":"…"}` body, or
     *  null when it sent something else. HTTP status alone does not identify a
     *  Bing failure — 400 covers both "bad request" and "invalid token". */
    public readonly errorCode: number | null = null,
  ) {
    super(message);
    this.name = "BingApiError";
  }
}

/** No fresh access token could be minted — the user revoked the grant, or the
 *  stored Bing grant expired. Mirrors GscTokenError. */
export class BingTokenError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "BingTokenError";
  }
}

/** A verified/unverified property on the Bing account, from GetUserSites. */
type BingSite = {
  url: string;
  isVerified: boolean;
  /** Same value for every site on an account — the account identifier
   *  (`webmasteruid`), not a per-site secret. Doubles as a verification code,
   *  so never render it. */
  authenticationCode: string | null;
  dnsVerificationCode: string | null;
};

/** GetRankAndTrafficStats returns one row per day. Field names verified
 *  against the live API on 2026-07-25: `Date` (WCF, carrying a timezone
 *  offset), `Clicks`, `Impressions`, plus the `__type` marker every WCF
 *  payload has. Extra fields are tolerated and ignored. */
/** One daily row from GetCrawlStats. */
type BingCrawlStatsRow = {
  /** ISO 8601, or null if Bing sent something unparseable. */
  date: string | null;
  crawledPages: number;
  inIndex: number;
  inLinks: number;
  crawlErrors: number;
  code4xx: number;
  code5xx: number;
  /** Fetches robots.txt forbade — deliberate for private paths, but a rising
   *  line means Bingbot wants something it's being denied. */
  blockedByRobotsTxt: number;
  /** Responses outside the 2xx/301/302/4xx/5xx buckets — typically 429s. */
  allOtherCodes: number;
};

/** Per-URL crawl evidence from GetUrlInfo. `known: false` means Bing has
 *  never discovered the URL (sentinel dates mapped to null). */
type BingUrlInfo = {
  url: string;
  known: boolean;
  discoveredAt: string | null;
  lastCrawledAt: string | null;
  documentSize: number;
  isPage: boolean;
  anchorCount: number;
  totalChildUrlCount: number;
};

/** One sampled row from GetQueryStats/GetPageStats. `key` is the query text,
 *  or the page URL for GetPageStats. */
type BingStatRow = {
  key: string;
  clicks: number;
  impressions: number;
  /** ISO 8601 sample date, or null if unparseable. Informational only —
   *  samples are too sparse for date slicing. */
  date: string | null;
  avgImpressionPosition: number;
};

type BingRankAndTrafficStatsRow = {
  /** ISO 8601, or null if Bing sent something unparseable. */
  date: string | null;
  clicks: number;
  impressions: number;
};

/** WCF serialises dates as the literal string "/Date(1445558400000)/" —
 *  milliseconds since epoch, optionally with a "+HHMM"/"-HHMM" timezone offset
 *  which is informational only (the ms value is already UTC). Returns null for
 *  anything that isn't that exact shape. GetUserSites carries no dates, but
 *  GetRankAndTrafficStats does. */
const WCF_DATE_PATTERN = /^\/Date\((-?\d+)(?:[+-]\d{4})?\)\/$/;

export function parseWcfDate(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const match = WCF_DATE_PATTERN.exec(value);
  if (!match) return null;
  const ms = Number(match[1]);
  if (!Number.isFinite(ms)) return null;
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Bing's InvalidToken code. Bing returns 400 with this for an access token it
 *  minted seconds earlier and will accept again on the next call: measured
 *  2026-08-12, one token, 10 sequential GetUserSites calls 7s apart succeeded
 *  4 times and failed this way 6 times, interleaved randomly. It means "retry",
 *  never "the grant is dead" — see isTransientBingFailure. */
const BING_INVALID_TOKEN_CODE = 18;

const bingErrorBodySchema = z.looseObject({ ErrorCode: z.number() });

function parseBingErrorCode(body: string): number | null {
  try {
    const parsed = bingErrorBodySchema.safeParse(JSON.parse(body));
    return parsed.success ? parsed.data.ErrorCode : null;
  } catch {
    // Bing also serves XML and HTML error pages, which carry no code we read.
    return null;
  }
}

/**
 * Bing answered in a way worth replaying the identical request for, rather
 * than surfacing. Every call this client makes is a read, so a retry is always
 * safe.
 *
 * Deliberately narrow: 429 already tells the user to wait, and 4xx/5xx that
 * Bing does not tag as InvalidToken are real failures. Retrying those would
 * turn one bad request into eight.
 */
export function isTransientBingFailure(error: unknown): boolean {
  if (!(error instanceof BingApiError)) return false;
  if (error.errorCode === BING_INVALID_TOKEN_CODE) return true;
  // Under load Bing answers 2xx with an empty or non-JSON body, which reaches
  // the envelope check with nothing to record as `body`. A 2xx that *did*
  // parse but carries no `d` is a genuine contract break, and is not retried.
  return error.status >= 200 && error.status < 300 && error.body === undefined;
}

/** Compact, secret-free summary for logs. `error.message` alone loses both the
 *  HTTP status and Bing's own ErrorCode, which are the only two things that
 *  identify a Bing failure. */
export function describeBingFailure(error: unknown): string {
  if (error instanceof BingApiError) {
    return `BingApiError status=${error.status} errorCode=${error.errorCode ?? "none"}: ${error.message}`;
  }
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

// The flapping is independent per call — successes and failures interleave on
// one token — so each retry is a fresh chance. Measured 2026-08-12 the per-call
// failure rate sat between 60% and 77%, and eight attempts cleared it on all
// three trials (1, 4 and 8 attempts, worst case 8s).
//
// Not longer than this: Bing starts answering 202 with an empty body when it is
// called in bursts, so a deeper ladder would buy a smaller failure rate by
// provoking the other failure mode. The picker offers "try again" for the tail,
// and the circuit breaker below caps the cost when the flapping is total rather
// than partial.
const BING_RETRY_DELAYS_MS = [100, 200, 400, 800, 1_200, 1_600, 2_000];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Retrying only pays while the flapping is partial. On 2026-08-12 Bing's OAuth
// acceptance went from ~30-40% to zero, and a single page load — three calls in
// parallel — spent 24 requests and 10s arriving at a failure the first attempt
// already knew about. Past this many transient failures in a row the ladder is
// suppressed until the cooldown lapses.
//
// Best-effort by design: this is per-isolate, so it is a cost cap rather than a
// global view of Bing's health, and it never fails a call Bing would have
// answered — only the *retries* are suppressed, the first attempt always runs.
// Must exceed the ladder length: one call working through its own retries is
// the case retrying exists for, and must never trip the breaker by itself. It
// takes several calls failing together — a page load's worth — to open it.
const BING_CIRCUIT_THRESHOLD = BING_RETRY_DELAYS_MS.length + 3;
const BING_CIRCUIT_COOLDOWN_MS = 60_000;

let consecutiveTransientFailures = 0;
let circuitOpenedAt = 0;

function recordBingSuccess(): void {
  consecutiveTransientFailures = 0;
  circuitOpenedAt = 0;
}

function recordTransientBingFailure(): void {
  consecutiveTransientFailures += 1;
  if (
    consecutiveTransientFailures >= BING_CIRCUIT_THRESHOLD &&
    !circuitOpenedAt
  ) {
    circuitOpenedAt = Date.now();
  }
}

function isBingRetryCircuitOpen(): boolean {
  if (!circuitOpenedAt) return false;
  if (Date.now() - circuitOpenedAt < BING_CIRCUIT_COOLDOWN_MS) return true;
  // Cooldown lapsed — let the next call ladder again so recovery is noticed.
  recordBingSuccess();
  return false;
}

/** Test seam: the breaker is module state, so a test that trips it would
 *  otherwise leak into the next one. */
export function resetBingRetryCircuit(): void {
  recordBingSuccess();
}

/** How a call proves who it is. Bing takes an OAuth bearer token in a header
 *  or an account-wide API key as a query param, and nothing else — sending the
 *  token as `?access_token=` is rejected as `InvalidApiKey` (probed
 *  2026-08-12), as is a lowercase `bearer` scheme. */
type BingAuth = { bearerToken: string } | { apiKey: string };

/** Appends by hand rather than via URL/searchParams: re-serialising the query
 *  can re-encode `siteUrl`, and Bing matches that value byte-for-byte.
 *
 *  The key lands in the URL, so this string must never be logged. Nothing here
 *  puts a URL in an error or a log line — keep it that way. */
function withApiKey(url: string, apiKey: string): string {
  return `${url}${url.includes("?") ? "&" : "?"}apikey=${encodeURIComponent(apiKey)}`;
}

/** One attempt: perform the call, map HTTP errors, then unwrap and return the
 *  `d` payload. */
async function sendBingRequest(
  url: string,
  auth: BingAuth,
  init?: { method?: string; body?: unknown },
): Promise<unknown> {
  const hasBody = init?.body !== undefined;
  const response = await fetch(
    "apiKey" in auth ? withApiKey(url, auth.apiKey) : url,
    {
      method: init?.method ?? "GET",
      headers: {
        ...("bearerToken" in auth
          ? { Authorization: `Bearer ${auth.bearerToken}` }
          : {}),
        Accept: "application/json",
        ...(hasBody ? { "Content-Type": "application/json" } : {}),
      },
      body: hasBody ? JSON.stringify(init?.body) : undefined,
    },
  );
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new BingApiError(
      response.status,
      messageForStatus(response.status, body),
      body,
      parseBingErrorCode(body),
    );
  }
  const raw = await response.json().catch(() => undefined);
  const envelope = bingEnvelopeSchema.safeParse(raw);
  if (!envelope.success) {
    throw new BingApiError(
      response.status,
      "Bing Webmaster returned an unexpected response (missing the `d` envelope).",
      typeof raw === "string" ? raw : JSON.stringify(raw)?.slice(0, 300),
    );
  }
  return envelope.data.d;
}

function messageForStatus(status: number, body: string): string {
  if (status === 401 || status === 403) {
    return "Bing Webmaster denied access (the connection was revoked, or this account has no verified permission). Reconnect Bing to continue.";
  }
  if (status === 429) {
    return "Bing Webmaster rate limit reached. Retry shortly.";
  }
  // Only reached once every retry has been spent, so say what is actually
  // wrong: Bing is flapping, the connection is fine, reconnecting won't help.
  if (parseBingErrorCode(body) === BING_INVALID_TOKEN_CODE) {
    return "Bing Webmaster kept rejecting a valid access token, which it does intermittently. Your connection is fine — try again shortly.";
  }
  if (status === 404) {
    return "Bing Webmaster site not found. It may have been removed in Bing Webmaster Tools.";
  }
  return `Bing Webmaster API error (${status}): ${body.slice(0, 300)}`;
}

/** Every Bing JSON response wraps its payload under a top-level `d` key
 *  (WCF envelope). A body without `d` is an error, not an empty result — so the
 *  key must be present, though its value may legitimately be `null`/`[]`. */
const bingEnvelopeSchema = z
  .looseObject({ d: z.unknown() })
  .refine((value) => "d" in value, { message: "missing `d` envelope" });

const rankAndTrafficStatsRowSchema = z.looseObject({
  Date: z.unknown(),
  Clicks: z.number(),
  Impressions: z.number(),
});

/** GetCrawlStats row (verified live 2026-07-25): a DENSE daily series like
 *  GetRankAndTrafficStats — one row per day over Bing's fixed ~6-month
 *  window. Fields beyond these six exist (Code301/302, ConnectionTimeout,
 *  DnsFailures, ContainsMalware, AllOtherCodes, BlockedByRobotsTxt) and are
 *  tolerated but unused. */
const crawlStatsRowSchema = z.looseObject({
  Date: z.unknown(),
  CrawledPages: z.number(),
  InIndex: z.number(),
  InLinks: z.number(),
  CrawlErrors: z.number(),
  Code4xx: z.number(),
  Code5xx: z.number(),
  BlockedByRobotsTxt: z.number(),
  AllOtherCodes: z.number(),
});

/** GetQueryStats and GetPageStats share one row shape (verified live
 *  2026-07-25): GetPageStats reuses the QueryStats type and puts the page URL
 *  in `Query`. `AvgClickPosition` is -1 when nothing was clicked, so it is
 *  ignored here; `AvgImpressionPosition` is the usable position signal. Rows
 *  are SAMPLED (~16 distinct dates over ~5 months) — callers must aggregate
 *  over the whole window, never slice by date. */
const queryStatsRowSchema = z.looseObject({
  Query: z.string(),
  Clicks: z.number(),
  Impressions: z.number(),
  Date: z.unknown(),
  AvgImpressionPosition: z.number(),
});

/** GetUrlInfo response (verified live 2026-07-30) — a single object, not an
 *  array. */
const urlInfoSchema = z.looseObject({
  Url: z.string(),
  DiscoveryDate: z.unknown(),
  LastCrawledDate: z.unknown(),
  DocumentSize: z.number(),
  IsPage: z.boolean(),
  AnchorCount: z.number(),
  TotalChildUrlCount: z.number(),
});

const bingSiteSchema = z.looseObject({
  Url: z.string(),
  IsVerified: z.boolean(),
  AuthenticationCode: z.string().nullish(),
  DnsVerificationCode: z.string().nullish(),
});

/**
 * How the caller authenticates to Bing. OAuth mints (and refreshes) an access
 * token from the connector's stored bing-webmaster grant; api_key uses Bing's
 * account-wide key verbatim. Every method behaves identically either way — the
 * one exception is `getConnectedEmail`, which has no token to read a claim
 * from and returns null under api_key.
 */
export type BingClientCredentials =
  | { mode: "oauth"; userId: string; bingAccountId?: string }
  | { mode: "api_key"; apiKey: string };

/** Free Bing Webmaster Tools client, modelled on createGscClient. It does NOT
 *  meter credits — Bing reads are first-party and free. */
export function createBingClient(opts: BingClientCredentials) {
  async function getToken(): Promise<string> {
    if (opts.mode !== "oauth") {
      throw new BingTokenError(
        "This Bing connection uses an API key, which carries no access token.",
      );
    }
    let result: { accessToken?: string } | undefined;
    try {
      // Headerless call: getAccessToken trusts body.userId when no request
      // session is present, and auto-refreshes via the genericOAuth provider.
      result = await getAuth().api.getAccessToken({
        body: {
          providerId: BING_OAUTH_PROVIDER_ID,
          userId: opts.userId,
          ...(opts.bingAccountId ? { accountId: opts.bingAccountId } : {}),
        },
      });
    } catch (error) {
      throw new BingTokenError(
        "Could not mint a Bing Webmaster access token (grant revoked or expired).",
        error,
      );
    }
    if (!result?.accessToken) {
      throw new BingTokenError(
        "Bing Webmaster returned no access token (grant revoked or expired).",
      );
    }
    return result.accessToken;
  }

  /** Perform the call, retrying Bing's transient answers on the same
   *  credential, then return the unwrapped `d` payload. Callers validate the
   *  payload shape with zod. Under OAuth the token is minted once: a retry is
   *  for Bing flapping, not for a credential problem, and re-minting per
   *  attempt would spend a subrequest to get the identical token back. */
  async function request(
    url: string,
    init?: { method?: string; body?: unknown },
  ): Promise<unknown> {
    const auth: BingAuth =
      opts.mode === "api_key"
        ? { apiKey: opts.apiKey }
        : { bearerToken: await getToken() };
    for (let attempt = 0; ; attempt++) {
      try {
        const payload = await sendBingRequest(url, auth, init);
        recordBingSuccess();
        return payload;
      } catch (error) {
        if (!isTransientBingFailure(error)) throw error;
        recordTransientBingFailure();
        if (
          attempt >= BING_RETRY_DELAYS_MS.length ||
          isBingRetryCircuitOpen()
        ) {
          throw error;
        }
        await sleep(BING_RETRY_DELAYS_MS[attempt]);
      }
    }
  }

  return {
    /** The connected Bing account's email. Bing publishes no userinfo
     *  endpoint, so unlike GSC this is read from a claim on the access token
     *  rather than fetched — no network call beyond minting the token. Returns
     *  null when the token carries no email claim, and always under api_key,
     *  which has no token and no other endpoint exposing the identity. */
    async getConnectedEmail(): Promise<string | null> {
      if (opts.mode === "api_key") return null;
      const claims = decodeBingAccessToken(await getToken());
      return claims?.webmasteremail ?? null;
    },

    /** GetUserSites — the verified/unverified properties on the grant. */
    async listSites(): Promise<BingSite[]> {
      const payload = await request(`${BING_API_BASE}/GetUserSites`);
      const sites = z.array(bingSiteSchema).parse(payload);
      return sites.map((site) => ({
        url: site.Url,
        isVerified: site.IsVerified,
        authenticationCode: site.AuthenticationCode ?? null,
        dnsVerificationCode: site.DnsVerificationCode ?? null,
      }));
    },

    /** GetRankAndTrafficStats — daily site totals. siteUrl is passed verbatim
     *  as a query param. WCF `/Date(ms)/` values in each row are converted to
     *  ISO strings. */
    async getRankAndTrafficStats(
      siteUrl: string,
    ): Promise<BingRankAndTrafficStatsRow[]> {
      const payload = await request(
        `${BING_API_BASE}/GetRankAndTrafficStats?siteUrl=${encodeURIComponent(siteUrl)}`,
      );
      const rows = z.array(rankAndTrafficStatsRowSchema).parse(payload);
      return rows.map((row) => ({
        date: parseWcfDate(row.Date)?.toISOString() ?? null,
        clicks: row.Clicks,
        impressions: row.Impressions,
      }));
    },

    /** GetCrawlStats — daily Bingbot crawl/index/link counts. Dense like
     *  getRankAndTrafficStats, not sampled. */
    async getCrawlStats(siteUrl: string): Promise<BingCrawlStatsRow[]> {
      const payload = await request(
        `${BING_API_BASE}/GetCrawlStats?siteUrl=${encodeURIComponent(siteUrl)}`,
      );
      const rows = z.array(crawlStatsRowSchema).parse(payload ?? []);
      return rows.map((row) => ({
        date: parseWcfDate(row.Date)?.toISOString() ?? null,
        crawledPages: row.CrawledPages,
        inIndex: row.InIndex,
        inLinks: row.InLinks,
        crawlErrors: row.CrawlErrors,
        code4xx: row.Code4xx,
        code5xx: row.Code5xx,
        blockedByRobotsTxt: row.BlockedByRobotsTxt,
        allOtherCodes: row.AllOtherCodes,
      }));
    },

    /** GetQueryStats — sampled per-query rows over Bing's fixed ~6-month
     *  window. */
    async getQueryStats(siteUrl: string): Promise<BingStatRow[]> {
      return fetchStatRows("GetQueryStats", siteUrl);
    },

    /** GetPageStats — sampled per-page rows; the page URL arrives in the
     *  `Query` field and is exposed as `key`. */
    async getPageStats(siteUrl: string): Promise<BingStatRow[]> {
      return fetchStatRows("GetPageStats", siteUrl);
    },

    /** GetPageQueryStats — sampled query rows filtered to one page. The
     *  parameter is named `page` (verified live 2026-07-25 — the docs
     *  disagree with themselves); an unknown page returns 0 rows, not an
     *  error. */
    async getPageQueryStats(
      siteUrl: string,
      pageUrl: string,
    ): Promise<BingStatRow[]> {
      return fetchStatRows("GetPageQueryStats", siteUrl, pageUrl);
    },

    /** GetUrlInfo — per-URL crawl evidence (verified live 2026-07-30). A URL
     *  Bing has never discovered still returns 200, with sentinel year-0001
     *  dates — surfaced here as known=false with null dates, never as a
     *  rendered date. HttpStatus is NOT mapped: it came back 0 in probing
     *  and cannot be trusted. */
    async getUrlInfo(siteUrl: string, url: string): Promise<BingUrlInfo> {
      const payload = await request(
        `${BING_API_BASE}/GetUrlInfo?siteUrl=${encodeURIComponent(siteUrl)}&url=${encodeURIComponent(url)}`,
      );
      const info = urlInfoSchema.parse(payload);
      const discovered = parseWcfDate(info.DiscoveryDate);
      const lastCrawled = parseWcfDate(info.LastCrawledDate);
      const known = Boolean(discovered && discovered.getTime() > 0);
      return {
        url: info.Url,
        known,
        discoveredAt: known ? (discovered?.toISOString() ?? null) : null,
        lastCrawledAt:
          known && lastCrawled && lastCrawled.getTime() > 0
            ? lastCrawled.toISOString()
            : null,
        documentSize: info.DocumentSize,
        isPage: info.IsPage,
        anchorCount: info.AnchorCount,
        totalChildUrlCount: info.TotalChildUrlCount,
      };
    },
  };

  async function fetchStatRows(
    method: "GetQueryStats" | "GetPageStats" | "GetPageQueryStats",
    siteUrl: string,
    pageUrl?: string,
  ): Promise<BingStatRow[]> {
    const pageParam = pageUrl ? `&page=${encodeURIComponent(pageUrl)}` : "";
    const payload = await request(
      `${BING_API_BASE}/${method}?siteUrl=${encodeURIComponent(siteUrl)}${pageParam}`,
    );
    const rows = z.array(queryStatsRowSchema).parse(payload ?? []);
    return rows.map((row) => ({
      key: row.Query,
      clicks: row.Clicks,
      impressions: row.Impressions,
      date: parseWcfDate(row.Date)?.toISOString() ?? null,
      avgImpressionPosition: row.AvgImpressionPosition,
    }));
  }
}

export type { BingStatRow, BingUrlInfo };
