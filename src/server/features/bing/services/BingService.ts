import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { account } from "@/db/schema";
import { BING_OAUTH_PROVIDER_ID } from "@/shared/bing";
import { AppError } from "@/server/lib/errors";
import {
  createBingClient,
  describeBingFailure,
  BingApiError,
  BingTokenError,
  type BingUrlInfo,
} from "@/server/lib/bingClient";
import {
  BingConnectionRepository,
  type BingConnection,
} from "@/server/features/bing/repositories/BingConnectionRepository";
import {
  decryptBingApiKey,
  encryptBingApiKey,
} from "@/server/features/bing/apiKeyCrypto";
import {
  aggregateBingStatRows,
  buildBingStrikingRows,
  type BingAggregateRow,
} from "@/server/features/bing/bingQueryReport";

type BingClient = ReturnType<typeof createBingClient>;
type BingSite = Awaited<ReturnType<BingClient["listSites"]>>[number];
type BingRankAndTrafficStatsRow = Awaited<
  ReturnType<BingClient["getRankAndTrafficStats"]>
>[number];
type BingCrawlStatsRow = Awaited<
  ReturnType<BingClient["getCrawlStats"]>
>[number];

type BingQueryReportResult = {
  siteUrl: string;
  connectedBy: string | null;
  queries: BingAggregateRow[];
  pages: BingAggregateRow[];
  striking: BingAggregateRow[];
};

type BingPerformanceResult = {
  siteUrl: string;
  connectedBy: string | null;
  rows: BingRankAndTrafficStatsRow[];
};

type BingSiteListResult = {
  accounts: Array<{
    accountId: string;
    email: string | null;
    requiresReconnect: boolean;
    sites: BingSite[];
  }>;
};

/** Thrown when a project has no connected Bing Webmaster site. */
export class BingNotConnectedError extends Error {
  constructor(public readonly projectId: string) {
    super("Bing Webmaster is not connected for this project");
    this.name = "BingNotConnectedError";
  }
}

async function getConnection(
  projectId: string,
): Promise<BingConnection | null> {
  return BingConnectionRepository.getByProjectId(projectId);
}

/** Whether this user has linked a bing-webmaster grant (regardless of whether
 *  they've picked a site yet). Drives the connect-vs-pick UI. */
async function userHasGrant(userId: string): Promise<boolean> {
  const rows = await db
    .select({ id: account.id })
    .from(account)
    .where(
      and(
        eq(account.userId, userId),
        eq(account.providerId, BING_OAUTH_PROVIDER_ID),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

async function listGrantsForUser(userId: string) {
  return db
    .select({ id: account.id, accountId: account.accountId })
    .from(account)
    .where(
      and(
        eq(account.userId, userId),
        eq(account.providerId, BING_OAUTH_PROVIDER_ID),
      ),
    );
}

/** Expected ways a stored grant fails to reach Bing Webmaster: no token could
 *  be minted (refresh token revoked or expired), or Bing rejected the call
 *  (401/403). These surface a reconnect prompt without fault logging.
 *
 *  Nothing else may be answered with a reconnect prompt. Bing intermittently
 *  rejects valid tokens with 400/ErrorCode 18 (see isTransientBingFailure);
 *  labelling that "connection expired" sends the user into a re-auth loop that
 *  cannot fix it, because the grant was never the problem. */
export function isExpectedGrantFailure(error: unknown): boolean {
  if (error instanceof BingTokenError) return true;
  return (
    error instanceof BingApiError &&
    (error.status === 401 || error.status === 403)
  );
}

async function listSitesForUserWithGrantStatus(
  userId: string,
): Promise<BingSiteListResult> {
  const grants = await listGrantsForUser(userId);
  const accounts = await Promise.all(
    grants.map(async (grant) => {
      const client = createBingClient({
        mode: "oauth",
        userId,
        bingAccountId: grant.accountId,
      });

      try {
        const sites = await client.listSites();
        // Best-effort: the account list must still render if the email claim
        // is missing, so this never fails the whole grant.
        let email: string | null = null;
        try {
          email = await client.getConnectedEmail();
        } catch {
          email = null;
        }
        return {
          accountId: grant.accountId,
          email,
          requiresReconnect: false,
          sites,
        };
      } catch (error) {
        if (isExpectedGrantFailure(error)) {
          return {
            accountId: grant.accountId,
            email: null,
            requiresReconnect: true,
            sites: [],
          };
        }
        // grant.id, never grant.accountId: the latter is the webmasteruid,
        // which doubles as Bing's site verification code. Logs and Sentry are
        // a lower-trust store than the database.
        console.error(
          "Failed to list Bing Webmaster sites for grant",
          grant.id,
          describeBingFailure(error),
        );
        // Fail the whole listing rather than dropping this account from the
        // picker: the caller renders "couldn't load your sites / try again",
        // which is what a Bing-side failure actually warrants.
        throw error;
      }
    }),
  );
  return { accounts };
}

/** Map a verified site to a project. Rejects unverified sites and sites not
 *  present on the connector's grant. */
async function setSite(input: {
  projectId: string;
  organizationId: string;
  siteUrl: string;
  accountId: string;
  userId: string;
}): Promise<BingConnection> {
  const grants = await listGrantsForUser(input.userId);
  if (!grants.some((grant) => grant.accountId === input.accountId)) {
    throw new AppError(
      "NOT_FOUND",
      "That Bing account isn't connected to your OpenSEO account.",
    );
  }

  const client = createBingClient({
    mode: "oauth",
    userId: input.userId,
    bingAccountId: input.accountId,
  });
  const sites = await client.listSites();
  const match = sites.find((s) => s.url === input.siteUrl);
  if (!match) {
    throw new AppError(
      "NOT_FOUND",
      "That Bing Webmaster site isn't available on your connected Bing account.",
    );
  }
  if (!match.isVerified) {
    throw new AppError(
      "FORBIDDEN",
      "That Bing Webmaster site isn't verified yet.",
    );
  }
  // Read from the access token's claims, not a userinfo endpoint (Bing has
  // none). A failure here must not block connecting — the repository coalesce
  // keeps any previously stored value.
  let connectedAccountEmail: string | null = null;
  try {
    connectedAccountEmail = await client.getConnectedEmail();
  } catch {
    connectedAccountEmail = null;
  }
  return BingConnectionRepository.upsert({
    projectId: input.projectId,
    organizationId: input.organizationId,
    siteUrl: input.siteUrl,
    connectedByUserId: input.userId,
    bingAccountId: input.accountId,
    connectedAccountEmail,
    authMode: "oauth",
    // Clears any key left by a previous api_key connection on this project.
    apiKeyEncrypted: null,
  });
}

/** Sites visible to an API key, for the picker. The key is verified by using
 *  it — Bing has no "validate key" endpoint — so a bad key surfaces here as
 *  the 400/ErrorCode 3 `InvalidApiKey` that Bing returns. */
async function listSitesForApiKey(apiKey: string): Promise<BingSite[]> {
  return createBingClient({ mode: "api_key", apiKey }).listSites();
}

/**
 * Connect a project with Bing's account-wide API key instead of OAuth.
 *
 * Mirrors setSite's checks — the site must exist on the account and be
 * verified — but proves ownership with the key itself rather than a grant, so
 * there is no `account` row and no `bingAccountId` to match against. Bing's
 * key carries no identity claim either, so `connectedAccountEmail` stays null.
 */
async function setSiteWithApiKey(input: {
  projectId: string;
  organizationId: string;
  siteUrl: string;
  apiKey: string;
  userId: string;
}): Promise<BingConnection> {
  const sites = await listSitesForApiKey(input.apiKey);
  const match = sites.find((s) => s.url === input.siteUrl);
  if (!match) {
    throw new AppError(
      "NOT_FOUND",
      "That Bing Webmaster site isn't available on the account this API key belongs to.",
    );
  }
  if (!match.isVerified) {
    throw new AppError(
      "FORBIDDEN",
      "That Bing Webmaster site isn't verified yet.",
    );
  }
  return BingConnectionRepository.upsert({
    projectId: input.projectId,
    organizationId: input.organizationId,
    siteUrl: input.siteUrl,
    connectedByUserId: input.userId,
    // The key is account-wide and carries no webmasteruid claim, so there is
    // no per-account identifier to record. Null also keeps disconnect() from
    // mistaking this row for one holding an OAuth grant still in use.
    bingAccountId: null,
    connectedAccountEmail: null,
    authMode: "api_key",
    apiKeyEncrypted: await encryptBingApiKey(input.apiKey),
  });
}

async function unlinkUserGrant(
  userId: string,
  bingAccountId: string,
): Promise<void> {
  await db
    .delete(account)
    .where(
      and(
        eq(account.userId, userId),
        eq(account.providerId, BING_OAUTH_PROVIDER_ID),
        eq(account.accountId, bingAccountId),
      ),
    );
}

async function disconnect(input: {
  projectId: string;
  userId: string;
}): Promise<void> {
  const connection = await BingConnectionRepository.getByProjectId(
    input.projectId,
  );
  await BingConnectionRepository.deleteByProjectId(input.projectId);
  if (
    connection?.bingAccountId &&
    connection.connectedByUserId === input.userId
  ) {
    const stillUsed = await BingConnectionRepository.existsForConnectorAccount(
      input.userId,
      connection.bingAccountId,
    );
    if (!stillUsed) {
      await unlinkUserGrant(input.userId, connection.bingAccountId);
    }
  }
}

/** Bing `GetRankAndTrafficStats` for a project's connected site: one row per
 *  day, typed by bingClient as { date, clicks, impressions }. Bing accepts no
 *  date range, dimensions, or paging here, which is why this takes only a
 *  projectId. */
async function getPerformance(input: {
  projectId: string;
}): Promise<BingPerformanceResult> {
  const { connection, client } = await resolveClient(input.projectId);
  const rows = await client.getRankAndTrafficStats(connection.siteUrl);
  return {
    siteUrl: connection.siteUrl,
    connectedBy: connection.connectedAccountEmail,
    rows,
  };
}

/** Per-URL crawl evidence (GetUrlInfo) for up to 10 URLs of the connected
 *  site. Per-URL failures are reported inline rather than failing the batch,
 *  except expected grant failures which abort the whole call (every URL
 *  would fail identically). */
async function inspectUrls(input: {
  projectId: string;
  urls: string[];
}): Promise<{
  siteUrl: string;
  results: Array<
    | ({ url: string; error?: undefined } & BingUrlInfo)
    | { url: string; error: string }
  >;
}> {
  const { connection, client } = await resolveClient(input.projectId);
  const results = await Promise.all(
    input.urls.map(async (url) => {
      try {
        return await client.getUrlInfo(connection.siteUrl, url);
      } catch (error) {
        if (isExpectedGrantFailure(error)) throw error;
        return {
          url,
          // Never an empty string: an Error carrying no message would otherwise
          // report as a URL with no problem at all.
          error:
            error instanceof Error && error.message
              ? error.message
              : "Bing did not return URL info for this URL.",
        };
      }
    }),
  );
  return { siteUrl: connection.siteUrl, results };
}

/** Resolve a project's connection to a ready client, whichever way it
 *  authenticates. Throws BingNotConnectedError when the project has no
 *  connection at all. */
async function resolveClient(projectId: string): Promise<{
  connection: BingConnection;
  client: BingClient;
}> {
  const connection = await BingConnectionRepository.getByProjectId(projectId);
  if (!connection) {
    throw new BingNotConnectedError(projectId);
  }
  return { connection, client: await clientForConnection(connection) };
}

/** The stored auth_mode decides the credential. A row marked api_key with no
 *  stored key is corrupt rather than empty — treat it as a connection to
 *  re-enter, never as a silent fallback to OAuth, which would call Bing as
 *  whoever happens to be in connectedByUserId. */
async function clientForConnection(
  connection: BingConnection,
): Promise<BingClient> {
  if (connection.authMode === "api_key") {
    if (!connection.apiKeyEncrypted) {
      throw new AppError(
        "CONFLICT",
        "This project's Bing connection is missing its API key. Re-enter it to reconnect.",
      );
    }
    return createBingClient({
      mode: "api_key",
      apiKey: await decryptBingApiKey(connection.apiKeyEncrypted),
    });
  }
  return createBingClient({
    mode: "oauth",
    userId: connection.connectedByUserId,
    bingAccountId: connection.bingAccountId ?? undefined,
  });
}

/** Aggregated query/page report from Bing's sampled GetQueryStats and
 *  GetPageStats windows (~16 sample dates over ~5 months). Whole-window
 *  totals only — Bing offers no date range, paging, or dimensions. */
async function getQueryReport(input: {
  projectId: string;
}): Promise<BingQueryReportResult> {
  const { connection, client } = await resolveClient(input.projectId);
  const [queryRows, pageRows] = await Promise.all([
    client.getQueryStats(connection.siteUrl),
    client.getPageStats(connection.siteUrl),
  ]);
  const queries = aggregateBingStatRows(queryRows);
  return {
    siteUrl: connection.siteUrl,
    connectedBy: connection.connectedAccountEmail,
    queries,
    pages: aggregateBingStatRows(pageRows),
    striking: buildBingStrikingRows(queries),
  };
}

/** Queries driving one specific page, from GetPageQueryStats — the join
 *  Bing's per-site methods can't express. Same sampled window and
 *  whole-window aggregation as getQueryReport; an unknown page yields an
 *  empty list, not an error. */
async function getPageQueries(input: {
  projectId: string;
  pageUrl: string;
}): Promise<{
  siteUrl: string;
  pageUrl: string;
  queries: BingAggregateRow[];
}> {
  const { connection, client } = await resolveClient(input.projectId);
  const rows = await client.getPageQueryStats(
    connection.siteUrl,
    input.pageUrl,
  );
  return {
    siteUrl: connection.siteUrl,
    pageUrl: input.pageUrl,
    queries: aggregateBingStatRows(rows),
  };
}

/** Daily Bingbot crawl/index/link counts from GetCrawlStats — dense like
 *  getPerformance's series, over the same fixed Bing-chosen window. Rows are
 *  sorted by date ascending; undated rows are dropped. */
async function getCrawlStats(input: { projectId: string }): Promise<{
  siteUrl: string;
  rows: BingCrawlStatsRow[];
}> {
  const { connection, client } = await resolveClient(input.projectId);
  const rows = await client.getCrawlStats(connection.siteUrl);
  return {
    siteUrl: connection.siteUrl,
    rows: rows
      .filter(
        (row): row is BingCrawlStatsRow & { date: string } => row.date !== null,
      )
      .toSorted((a, b) => a.date.localeCompare(b.date)),
  };
}

export const BingService = {
  getConnection,
  userHasGrant,
  listSitesForUserWithGrantStatus,
  listSitesForApiKey,
  setSite,
  setSiteWithApiKey,
  disconnect,
  getPerformance,
  getQueryReport,
  getPageQueries,
  getCrawlStats,
  inspectUrls,
};
