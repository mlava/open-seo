import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { waitUntil } from "cloudflare:workers";
import { z } from "zod";
import {
  BingNotConnectedError,
  BingService,
  isExpectedGrantFailure,
} from "@/server/features/bing/services/BingService";
import { hasSelfHostedBingConfig } from "@/server/features/bing/oauth-config";
import { createSelfHostedBingAuthorizationUrl } from "@/server/features/bing/selfHostedOAuth";
import { captureServerEvent } from "@/server/lib/posthog";
import { isHostedServerAuthMode } from "@/server/lib/runtime-env";
import { getPublicOrigin } from "@/server/mcp/public-origin";
import {
  requireAuthenticatedContext,
  requireProjectContext,
} from "@/serverFunctions/middleware";

const projectScopedSchema = z.object({ projectId: z.string().min(1) });
const startSelfHostedLinkSchema = z.object({
  callbackURL: z.string().min(1),
});
const pageQueriesSchema = projectScopedSchema.extend({
  pageUrl: z.string().url(),
});
const setSiteSchema = projectScopedSchema.extend({
  accountId: z.string().min(1),
  siteUrl: z.string().min(1),
});
// Bing's key is a 32-char hex string today, but that is undocumented, so this
// only trims and bounds it rather than pinning a format Bing may widen.
const apiKeySchema = z.string().trim().min(8).max(256);
const listSitesForApiKeySchema = projectScopedSchema.extend({
  apiKey: apiKeySchema,
});
const setSiteWithApiKeySchema = projectScopedSchema.extend({
  apiKey: apiKeySchema,
  siteUrl: z.string().min(1),
});

export const getBingConnection = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectScopedSchema)
  .handler(async ({ context }) => {
    const [connection, currentUserHasGrant, hosted, bingConfigured] =
      await Promise.all([
        BingService.getConnection(context.projectId),
        BingService.userHasGrant(context.userId),
        isHostedServerAuthMode(),
        hasSelfHostedBingConfig(),
      ]);
    return {
      connected: Boolean(connection),
      currentUserHasGrant,
      bingOAuthConfigured: hosted || bingConfigured,
      siteUrl: connection?.siteUrl ?? null,
      connectedByEmail: connection?.connectedAccountEmail ?? null,
      connectedAt: connection?.createdAt ?? null,
      // Never the key itself — only which lane this project connected on, so
      // the card can say so and offer the matching reconnect path.
      authMode: connection?.authMode ?? null,
    };
  });

export const listBingSites = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectScopedSchema)
  .handler(async ({ context }) => {
    const [siteList, connection] = await Promise.all([
      BingService.listSitesForUserWithGrantStatus(context.userId),
      BingService.getConnection(context.projectId),
    ]);
    return {
      accounts: siteList.accounts.map((grant) => ({
        accountId: grant.accountId,
        email: grant.email,
        requiresReconnect: grant.requiresReconnect,
        sites: grant.sites.map((site) => ({
          siteUrl: site.url,
          isVerified: site.isVerified,
          selectable: site.isVerified,
          isSelected:
            connection?.bingAccountId === grant.accountId &&
            connection.siteUrl === site.url,
        })),
      })),
    };
  });

export const setBingSite = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(setSiteSchema)
  .handler(async ({ data, context }) => {
    const connection = await BingService.setSite({
      projectId: context.projectId,
      organizationId: context.organizationId,
      accountId: data.accountId,
      siteUrl: data.siteUrl,
      userId: context.userId,
    });
    waitUntil(
      captureServerEvent({
        distinctId: context.userId,
        event: "bing:site_select",
        organizationId: context.organizationId,
        properties: { project_id: context.projectId, site_url: data.siteUrl },
      }),
    );
    return { connected: true as const, siteUrl: connection.siteUrl };
  });

/**
 * Sites an API key can see, so the user can pick one before it is stored.
 *
 * The key arrives in the request body and is deliberately not persisted here —
 * nothing is written until setBingSiteWithApiKey. It is also never echoed back
 * in the response.
 */
export const listBingSitesForApiKey = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(listSitesForApiKeySchema)
  .handler(async ({ data }) => {
    const sites = await BingService.listSitesForApiKey(data.apiKey);
    return {
      sites: sites.map((site) => ({
        siteUrl: site.url,
        isVerified: site.isVerified,
        selectable: site.isVerified,
      })),
    };
  });

/** Connect a project using Bing's account-wide API key instead of OAuth. The
 *  key is encrypted before it reaches the database. */
export const setBingSiteWithApiKey = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(setSiteWithApiKeySchema)
  .handler(async ({ data, context }) => {
    const connection = await BingService.setSiteWithApiKey({
      projectId: context.projectId,
      organizationId: context.organizationId,
      siteUrl: data.siteUrl,
      apiKey: data.apiKey,
      userId: context.userId,
    });
    waitUntil(
      captureServerEvent({
        distinctId: context.userId,
        event: "bing:site_select",
        organizationId: context.organizationId,
        properties: {
          project_id: context.projectId,
          site_url: data.siteUrl,
          auth_mode: "api_key",
        },
      }),
    );
    return { connected: true as const, siteUrl: connection.siteUrl };
  });

export const disconnectBing = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectScopedSchema)
  .handler(async ({ context }) => {
    await BingService.disconnect({
      projectId: context.projectId,
      userId: context.userId,
    });
    waitUntil(
      captureServerEvent({
        distinctId: context.userId,
        event: "bing:disconnect",
        organizationId: context.organizationId,
        properties: { project_id: context.projectId },
      }),
    );
    return { connected: false as const };
  });

/**
 * Daily clicks/impressions for the project's connected Bing site.
 *
 * Bing's GetRankAndTrafficStats takes no date range, no dimensions, and no
 * paging — it returns whatever window Bing decides to give. That is why this
 * has none of the filter arguments the Search Console report takes, and why
 * the Bing surface is separate rather than a source toggle on it.
 *
 * Not connected, or a dead grant, resolves to { connected: false } so the page
 * renders the connect card instead of an error boundary.
 */
export const getBingPerformance = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectScopedSchema)
  .handler(async ({ context }) => {
    try {
      const result = await BingService.getPerformance({
        projectId: context.projectId,
      });
      return {
        connected: true as const,
        siteUrl: result.siteUrl,
        connectedBy: result.connectedBy,
        rows: result.rows,
      };
    } catch (error) {
      if (
        error instanceof BingNotConnectedError ||
        isExpectedGrantFailure(error)
      ) {
        return { connected: false as const };
      }
      throw error;
    }
  });

/**
 * Aggregated query and page report for the project's connected Bing site.
 *
 * Backed by GetQueryStats/GetPageStats, whose rows are SAMPLED at roughly 16
 * dates over ~5 months — so rows are aggregated over the whole window and no
 * date range is offered. Striking distance is the query rows at positions
 * 5–20 sorted by impressions.
 *
 * Separate from getBingPerformance so the (dense, fast) daily tiles render
 * without waiting on the two sampled-stats calls.
 */
export const getBingQueryReport = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectScopedSchema)
  .handler(async ({ context }) => {
    try {
      const result = await BingService.getQueryReport({
        projectId: context.projectId,
      });
      return {
        connected: true as const,
        siteUrl: result.siteUrl,
        connectedBy: result.connectedBy,
        queries: result.queries,
        pages: result.pages,
        striking: result.striking,
      };
    } catch (error) {
      if (
        error instanceof BingNotConnectedError ||
        isExpectedGrantFailure(error)
      ) {
        return { connected: false as const };
      }
      throw error;
    }
  });

/**
 * Queries driving one specific page (GetPageQueryStats) — the drill-down
 * from the Pages tab. Same sampled-window aggregation and connection
 * handling as getBingQueryReport.
 */
export const getBingPageQueries = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(pageQueriesSchema)
  .handler(async ({ data, context }) => {
    try {
      const result = await BingService.getPageQueries({
        projectId: context.projectId,
        pageUrl: data.pageUrl,
      });
      return {
        connected: true as const,
        siteUrl: result.siteUrl,
        pageUrl: result.pageUrl,
        queries: result.queries,
      };
    } catch (error) {
      if (
        error instanceof BingNotConnectedError ||
        isExpectedGrantFailure(error)
      ) {
        return { connected: false as const };
      }
      throw error;
    }
  });

/**
 * Daily Bingbot crawl/index/link counts (GetCrawlStats) — dense daily
 * series over Bing's fixed window, powering the Crawl tab.
 */
export const getBingCrawlStats = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectScopedSchema)
  .handler(async ({ context }) => {
    try {
      const result = await BingService.getCrawlStats({
        projectId: context.projectId,
      });
      return {
        connected: true as const,
        siteUrl: result.siteUrl,
        rows: result.rows,
      };
    } catch (error) {
      if (
        error instanceof BingNotConnectedError ||
        isExpectedGrantFailure(error)
      ) {
        return { connected: false as const };
      }
      throw error;
    }
  });

/**
 * Begin the Bing OAuth grant on a self-hosted deployment.
 *
 * Better Auth's `oauth2.link` requires a Better Auth session, which does not
 * exist under `cloudflare_access` or `local_noauth`; those modes use this
 * hand-rolled flow instead, exactly as Search Console does.
 */
export const startSelfHostedBingLink = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .validator(startSelfHostedLinkSchema)
  .handler(async ({ data, context }) => {
    const publicOrigin = getPublicOrigin(getRequest());
    const url = await createSelfHostedBingAuthorizationUrl({
      user: { userId: context.userId, userEmail: context.userEmail },
      callbackURL: data.callbackURL,
      publicOrigin,
    });

    return { url };
  });
