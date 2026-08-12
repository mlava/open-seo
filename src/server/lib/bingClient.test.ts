/* eslint-disable max-lines, max-lines-per-function */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAccessToken: vi.fn(),
  fetch: vi.fn<typeof fetch>(),
}));

vi.mock("@/lib/auth", () => ({
  getAuth: () => ({ api: { getAccessToken: mocks.getAccessToken } }),
}));

function jsonResponse(body: unknown, status = 200) {
  return Response.json(body, { status });
}

/** Base64url-encoded JSON, the shape Bing's access tokens actually take. */
function accessToken(claims: Record<string, unknown>) {
  const bytes = new TextEncoder().encode(JSON.stringify(claims));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

describe("bingClient", () => {
  beforeEach(() => {
    mocks.getAccessToken.mockReset();
    mocks.getAccessToken.mockResolvedValue({ accessToken: "tok_bing" });
    mocks.fetch.mockReset();
    vi.stubGlobal("fetch", mocks.fetch);
    // The retry circuit breaker is module state: a test that trips it would
    // otherwise suppress the next test's retries.
    vi.resetModules();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("unwraps the `d` envelope and maps PascalCase sites with a bearer token", async () => {
    mocks.fetch.mockResolvedValue(
      jsonResponse({
        d: [
          {
            __type: "Site:#Microsoft.Bing.Webmaster.Api",
            AuthenticationCode: "acct-code-1",
            DnsVerificationCode: "dns-1",
            IsVerified: true,
            Url: "https://example.com/",
          },
          {
            __type: "Site:#Microsoft.Bing.Webmaster.Api",
            AuthenticationCode: "acct-code-1",
            DnsVerificationCode: "dns-2",
            IsVerified: false,
            Url: "https://blog.example.com/",
          },
        ],
      }),
    );
    const { createBingClient } = await import("./bingClient");
    const sites = await createBingClient({ mode: "oauth", userId: "u1" }).listSites();

    expect(sites).toEqual([
      {
        url: "https://example.com/",
        isVerified: true,
        authenticationCode: "acct-code-1",
        dnsVerificationCode: "dns-1",
      },
      {
        url: "https://blog.example.com/",
        isVerified: false,
        authenticationCode: "acct-code-1",
        dnsVerificationCode: "dns-2",
      },
    ]);

    const [url, init] = mocks.fetch.mock.calls[0];
    expect(url).toBe(
      "https://ssl.bing.com/webmaster/api.svc/json/GetUserSites",
    );
    expect(init?.headers).toMatchObject({ Authorization: "Bearer tok_bing" });
  });

  it("targets the selected Better Auth grant by webmasteruid", async () => {
    mocks.fetch.mockResolvedValue(jsonResponse({ d: [] }));
    const { createBingClient } = await import("./bingClient");

    await createBingClient({
      mode: "oauth",
      userId: "u1",
      bingAccountId: "webmaster-uid-a",
    }).listSites();

    expect(mocks.getAccessToken).toHaveBeenCalledWith({
      body: {
        providerId: "bing-webmaster",
        userId: "u1",
        accountId: "webmaster-uid-a",
      },
    });
  });

  it("omits accountId when no bingAccountId is given", async () => {
    mocks.fetch.mockResolvedValue(jsonResponse({ d: [] }));
    const { createBingClient } = await import("./bingClient");

    await createBingClient({ mode: "oauth", userId: "u1" }).listSites();

    expect(mocks.getAccessToken).toHaveBeenCalledWith({
      body: { providerId: "bing-webmaster", userId: "u1" },
    });
  });

  it("treats a 200 response missing `d` as a BingApiError, not an empty result", async () => {
    mocks.fetch.mockResolvedValue(jsonResponse({ notD: [] }));
    const { createBingClient, BingApiError } = await import("./bingClient");
    await expect(
      createBingClient({ mode: "oauth", userId: "u1" }).listSites(),
    ).rejects.toBeInstanceOf(BingApiError);
  });

  it("encodes the siteUrl and maps the verified rank/traffic row shape", async () => {
    mocks.fetch.mockResolvedValue(
      jsonResponse({
        d: [
          {
            // Exactly what the live API returned on 2026-07-25, including the
            // __type marker and the timezone offset on the date.
            __type: "RankAndTrafficStats:#Microsoft.Bing.Webmaster.Api",
            Date: "/Date(1445558400000-0700)/",
            Clicks: 42,
            Impressions: 1000,
          },
        ],
      }),
    );
    const { createBingClient } = await import("./bingClient");
    const rows = await createBingClient({
      mode: "oauth",
      userId: "u1",
    }).getRankAndTrafficStats("https://example.com/");

    expect(mocks.fetch.mock.calls[0][0]).toBe(
      "https://ssl.bing.com/webmaster/api.svc/json/GetRankAndTrafficStats?siteUrl=https%3A%2F%2Fexample.com%2F",
    );
    expect(rows).toEqual([
      {
        date: new Date(1445558400000).toISOString(),
        clicks: 42,
        impressions: 1000,
      },
    ]);
  });

  it("maps 401 to a reconnect-flavoured BingApiError", async () => {
    mocks.fetch.mockResolvedValue(jsonResponse({ error: "unauthorized" }, 401));
    const { createBingClient, BingApiError } = await import("./bingClient");
    const error = await createBingClient({ mode: "oauth", userId: "u1" })
      .listSites()
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(BingApiError);
    if (!(error instanceof BingApiError)) throw error;
    expect(error.status).toBe(401);
    expect(error.message).toMatch(/reconnect/i);
  });

  it("maps 403 to a reconnect-flavoured BingApiError", async () => {
    mocks.fetch.mockResolvedValue(jsonResponse({ error: "forbidden" }, 403));
    const { createBingClient, BingApiError } = await import("./bingClient");
    const error = await createBingClient({ mode: "oauth", userId: "u1" })
      .listSites()
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(BingApiError);
    if (!(error instanceof BingApiError)) throw error;
    expect(error.status).toBe(403);
    expect(error.message).toMatch(/revoked|reconnect/i);
  });

  it("maps 429 to a rate-limit BingApiError", async () => {
    mocks.fetch.mockResolvedValue(jsonResponse({ error: "slow down" }, 429));
    const { createBingClient } = await import("./bingClient");
    await expect(
      createBingClient({ mode: "oauth", userId: "u1" }).listSites(),
    ).rejects.toMatchObject({ status: 429 });
  });

  describe("api_key mode", () => {
    it("sends the key as a query param and no Authorization header", async () => {
      mocks.fetch.mockResolvedValue(jsonResponse({ d: [] }));
      const { createBingClient } = await import("./bingClient");

      await createBingClient({ mode: "api_key", apiKey: "k3y" }).listSites();

      const [url, init] = mocks.fetch.mock.calls[0];
      expect(url).toBe(
        "https://ssl.bing.com/webmaster/api.svc/json/GetUserSites?apikey=k3y",
      );
      expect(init?.headers).not.toHaveProperty("Authorization");
      // No grant to read, so nothing should be minted.
      expect(mocks.getAccessToken).not.toHaveBeenCalled();
    });

    it("appends the key without disturbing an encoded siteUrl", async () => {
      mocks.fetch.mockResolvedValue(jsonResponse({ d: [] }));
      const { createBingClient } = await import("./bingClient");

      await createBingClient({
        mode: "api_key",
        apiKey: "k/3+y",
      }).getRankAndTrafficStats("https://example.com/");

      // Bing matches siteUrl byte-for-byte, so its encoding must survive
      // verbatim while the key itself is escaped.
      expect(mocks.fetch.mock.calls[0][0]).toBe(
        "https://ssl.bing.com/webmaster/api.svc/json/GetRankAndTrafficStats?siteUrl=https%3A%2F%2Fexample.com%2F&apikey=k%2F3%2By",
      );
    });

    it("reports no connected email — a key carries no identity", async () => {
      const { createBingClient } = await import("./bingClient");
      await expect(
        createBingClient({ mode: "api_key", apiKey: "k3y" }).getConnectedEmail(),
      ).resolves.toBeNull();
      expect(mocks.fetch).not.toHaveBeenCalled();
    });
  });

  describe("InvalidToken retries", () => {
    // The backoff ladder spans seconds; drive it rather than wait it out.
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    /** Bing's 400/ErrorCode 18 — returned for a token it minted seconds ago
     *  and will accept on the next call. */
    const invalidToken = () =>
      jsonResponse({ ErrorCode: 18, Message: "ERROR!!! InvalidToken" }, 400);

    it("replays the request on the same token until Bing answers", async () => {
      mocks.fetch
        .mockResolvedValueOnce(invalidToken())
        .mockResolvedValueOnce(invalidToken())
        .mockResolvedValueOnce(jsonResponse({ d: [] }));
      const { createBingClient } = await import("./bingClient");

      const sites = createBingClient({ mode: "oauth", userId: "u1" }).listSites();
      await vi.runAllTimersAsync();

      await expect(sites).resolves.toEqual([]);
      expect(mocks.fetch).toHaveBeenCalledTimes(3);
      // One mint, reused across attempts: a retry is for Bing flapping, not
      // for a credential problem.
      expect(mocks.getAccessToken).toHaveBeenCalledTimes(1);
    });

    it("gives up with the ErrorCode intact once the retries are spent", async () => {
      // A fresh Response per attempt: a body can only be read once.
      mocks.fetch.mockImplementation(async () => invalidToken());
      const { createBingClient } = await import("./bingClient");

      const sites = createBingClient({ mode: "oauth", userId: "u1" }).listSites();
      // Assert before advancing: the rejection lands mid-ladder, and an
      // unhandled one would fail the run.
      const settled = expect(sites).rejects.toMatchObject({
        status: 400,
        errorCode: 18,
      });
      await vi.runAllTimersAsync();
      await settled;

      expect(mocks.fetch).toHaveBeenCalledTimes(8);
    });

    it("retries a 2xx whose body Bing left empty", async () => {
      mocks.fetch
        .mockResolvedValueOnce(new Response(null, { status: 202 }))
        .mockResolvedValueOnce(jsonResponse({ d: [] }));
      const { createBingClient } = await import("./bingClient");

      const sites = createBingClient({ mode: "oauth", userId: "u1" }).listSites();
      await vi.runAllTimersAsync();

      await expect(sites).resolves.toEqual([]);
      expect(mocks.fetch).toHaveBeenCalledTimes(2);
    });

    it("does not retry a 400 Bing tagged with another code", async () => {
      mocks.fetch.mockResolvedValue(
        jsonResponse({ ErrorCode: 3, Message: "ERROR!!! InvalidApiKey" }, 400),
      );
      const { createBingClient } = await import("./bingClient");

      await expect(
        createBingClient({ mode: "oauth", userId: "u1" }).listSites(),
      ).rejects.toMatchObject({ status: 400, errorCode: 3 });
      expect(mocks.fetch).toHaveBeenCalledTimes(1);
    });

    it("caps the cost when a whole page load fails together", async () => {
      mocks.fetch.mockImplementation(async () => invalidToken());
      const { createBingClient } = await import("./bingClient");
      const client = createBingClient({ mode: "oauth", userId: "u1" });

      // The Bing performance page fires three calls in parallel. Unbounded that
      // is 3 full ladders; the breaker has to stop it well short.
      const calls = Promise.all([
        client.listSites().catch(() => "failed"),
        client.listSites().catch(() => "failed"),
        client.listSites().catch(() => "failed"),
      ]);
      await vi.runAllTimersAsync();
      await expect(calls).resolves.toEqual(["failed", "failed", "failed"]);
      // 24 unbounded; 12 measured with the breaker, and 3 on the loads after.
      expect(mocks.fetch.mock.calls.length).toBeLessThanOrEqual(12);

      // Still one attempt per call afterwards — Bing may have recovered, and
      // the breaker must never fail a call it would have answered.
      mocks.fetch.mockClear();
      const next = client.listSites();
      const settled = expect(next).rejects.toMatchObject({ errorCode: 18 });
      await vi.runAllTimersAsync();
      await settled;
      expect(mocks.fetch).toHaveBeenCalledTimes(1);
    });

    it("restores the ladder once Bing answers again", async () => {
      mocks.fetch.mockImplementation(async () => invalidToken());
      const { createBingClient } = await import("./bingClient");
      const client = createBingClient({ mode: "oauth", userId: "u1" });

      const tripped = Promise.all([
        client.listSites().catch(() => "failed"),
        client.listSites().catch(() => "failed"),
      ]);
      await vi.runAllTimersAsync();
      await tripped;

      mocks.fetch.mockReset().mockResolvedValueOnce(jsonResponse({ d: [] }));
      await expect(client.listSites()).resolves.toEqual([]);

      mocks.fetch
        .mockReset()
        .mockResolvedValueOnce(invalidToken())
        .mockResolvedValueOnce(jsonResponse({ d: [] }));
      const recovered = client.listSites();
      await vi.runAllTimersAsync();
      await expect(recovered).resolves.toEqual([]);
      expect(mocks.fetch).toHaveBeenCalledTimes(2);
    });

    it("does not retry a 2xx body that parsed but carries no `d`", async () => {
      mocks.fetch.mockResolvedValue(jsonResponse({ notD: [] }));
      const { createBingClient } = await import("./bingClient");

      await expect(
        createBingClient({ mode: "oauth", userId: "u1" }).listSites(),
      ).rejects.toBeInstanceOf(Error);
      expect(mocks.fetch).toHaveBeenCalledTimes(1);
    });
  });

  it("throws BingTokenError when no access token can be minted", async () => {
    mocks.getAccessToken.mockRejectedValue(new Error("revoked"));
    const { createBingClient, BingTokenError } = await import("./bingClient");
    await expect(
      createBingClient({ mode: "oauth", userId: "u1" }).listSites(),
    ).rejects.toBeInstanceOf(BingTokenError);
  });

  it("throws BingTokenError when the token response has no accessToken", async () => {
    mocks.getAccessToken.mockResolvedValue({});
    const { createBingClient, BingTokenError } = await import("./bingClient");
    await expect(
      createBingClient({ mode: "oauth", userId: "u1" }).listSites(),
    ).rejects.toBeInstanceOf(BingTokenError);
  });

  describe("getCrawlStats", () => {
    it("maps the daily crawl row shape and tolerates extra fields", async () => {
      mocks.fetch.mockResolvedValue(
        jsonResponse({
          d: [
            {
              __type: "CrawlStats:#Microsoft.Bing.Webmaster.Api",
              Date: "/Date(1769414400000-0800)/",
              CrawledPages: 174,
              InIndex: 53,
              InLinks: 150,
              CrawlErrors: 2,
              Code2xx: 119,
              Code301: 0,
              Code302: 0,
              Code4xx: 1,
              Code5xx: 0,
              AllOtherCodes: 0,
              BlockedByRobotsTxt: 0,
              ConnectionTimeout: 0,
              ContainsMalware: 0,
              DnsFailures: 0,
            },
          ],
        }),
      );
      const { createBingClient } = await import("./bingClient");
      const rows = await createBingClient({ mode: "oauth", userId: "u1" }).getCrawlStats(
        "https://example.com/",
      );

      expect(mocks.fetch.mock.calls[0][0]).toBe(
        "https://ssl.bing.com/webmaster/api.svc/json/GetCrawlStats?siteUrl=https%3A%2F%2Fexample.com%2F",
      );
      expect(rows).toEqual([
        {
          date: new Date(1769414400000).toISOString(),
          crawledPages: 174,
          inIndex: 53,
          inLinks: 150,
          crawlErrors: 2,
          code4xx: 1,
          code5xx: 0,
          blockedByRobotsTxt: 0,
          allOtherCodes: 0,
        },
      ]);
    });

    it("treats a null `d` payload as an empty result", async () => {
      mocks.fetch.mockResolvedValue(jsonResponse({ d: null }));
      const { createBingClient } = await import("./bingClient");
      await expect(
        createBingClient({ mode: "oauth", userId: "u1" }).getCrawlStats(
          "https://example.com/",
        ),
      ).resolves.toEqual([]);
    });
  });

  describe("getQueryStats / getPageStats", () => {
    const sampleRow = {
      __type: "QueryStats:#Microsoft.Bing.Webmaster.Api",
      Query: "open seo",
      Clicks: 12,
      Impressions: 340,
      Date: "/Date(1445558400000-0700)/",
      AvgClickPosition: -1,
      AvgImpressionPosition: 7.4,
    };

    it("encodes the siteUrl and maps sampled query rows, key from Query", async () => {
      mocks.fetch.mockResolvedValue(jsonResponse({ d: [sampleRow] }));
      const { createBingClient } = await import("./bingClient");
      const rows = await createBingClient({ mode: "oauth", userId: "u1" }).getQueryStats(
        "https://example.com/",
      );

      expect(mocks.fetch.mock.calls[0][0]).toBe(
        "https://ssl.bing.com/webmaster/api.svc/json/GetQueryStats?siteUrl=https%3A%2F%2Fexample.com%2F",
      );
      expect(rows).toEqual([
        {
          key: "open seo",
          clicks: 12,
          impressions: 340,
          date: new Date(1445558400000).toISOString(),
          avgImpressionPosition: 7.4,
        },
      ]);
    });

    it("getPageStats hits GetPageStats and carries the page URL in key", async () => {
      mocks.fetch.mockResolvedValue(
        jsonResponse({
          d: [{ ...sampleRow, Query: "https://example.com/pricing" }],
        }),
      );
      const { createBingClient } = await import("./bingClient");
      const rows = await createBingClient({ mode: "oauth", userId: "u1" }).getPageStats(
        "https://example.com/",
      );

      expect(mocks.fetch.mock.calls[0][0]).toBe(
        "https://ssl.bing.com/webmaster/api.svc/json/GetPageStats?siteUrl=https%3A%2F%2Fexample.com%2F",
      );
      expect(rows[0].key).toBe("https://example.com/pricing");
    });

    it("getPageQueryStats passes the page as the `page` query param", async () => {
      mocks.fetch.mockResolvedValue(jsonResponse({ d: [sampleRow] }));
      const { createBingClient } = await import("./bingClient");
      const rows = await createBingClient({ mode: "oauth", userId: "u1" }).getPageQueryStats(
        "https://example.com/",
        "https://example.com/pricing?x=1",
      );

      expect(mocks.fetch.mock.calls[0][0]).toBe(
        "https://ssl.bing.com/webmaster/api.svc/json/GetPageQueryStats?siteUrl=https%3A%2F%2Fexample.com%2F&page=https%3A%2F%2Fexample.com%2Fpricing%3Fx%3D1",
      );
      expect(rows[0].key).toBe("open seo");
    });

    it("treats a null `d` payload as an empty result", async () => {
      mocks.fetch.mockResolvedValue(jsonResponse({ d: null }));
      const { createBingClient } = await import("./bingClient");
      await expect(
        createBingClient({ mode: "oauth", userId: "u1" }).getQueryStats(
          "https://example.com/",
        ),
      ).resolves.toEqual([]);
    });

    it("treats a 200 response missing `d` as a BingApiError", async () => {
      mocks.fetch.mockResolvedValue(jsonResponse({ notD: [] }));
      const { createBingClient, BingApiError } = await import("./bingClient");
      await expect(
        createBingClient({ mode: "oauth", userId: "u1" }).getPageStats("https://example.com/"),
      ).rejects.toBeInstanceOf(BingApiError);
    });
  });

  describe("getUrlInfo", () => {
    it("maps a known URL with real dates", async () => {
      mocks.fetch.mockResolvedValue(
        jsonResponse({
          d: {
            __type: "UrlInfo:#Microsoft.Bing.Webmaster.Api",
            Url: "https://example.com/pricing",
            DiscoveryDate: "/Date(1777446000000-0700)/",
            LastCrawledDate: "/Date(1785362025000)/",
            DocumentSize: 127674,
            HttpStatus: 0,
            IsPage: true,
            AnchorCount: 3,
            TotalChildUrlCount: 0,
          },
        }),
      );
      const { createBingClient } = await import("./bingClient");

      const info = await createBingClient({ mode: "oauth", userId: "u1" }).getUrlInfo(
        "https://example.com/",
        "https://example.com/pricing",
      );

      expect(mocks.fetch.mock.calls[0][0]).toBe(
        "https://ssl.bing.com/webmaster/api.svc/json/GetUrlInfo?siteUrl=https%3A%2F%2Fexample.com%2F&url=https%3A%2F%2Fexample.com%2Fpricing",
      );
      expect(info).toEqual({
        url: "https://example.com/pricing",
        known: true,
        discoveredAt: new Date(1777446000000).toISOString(),
        lastCrawledAt: new Date(1785362025000).toISOString(),
        documentSize: 127674,
        isPage: true,
        anchorCount: 3,
        totalChildUrlCount: 0,
      });
    });

    it("maps Bing's year-0001 sentinel to known=false with null dates", async () => {
      // A URL Bing never discovered still returns 200 — with DateTime.MinValue
      // dates (verified live 2026-07-30). Must never render as a real date.
      mocks.fetch.mockResolvedValue(
        jsonResponse({
          d: {
            Url: "https://example.com/never-seen",
            DiscoveryDate: "/Date(-62135568000000-0800)/",
            LastCrawledDate: "/Date(-62135568000000-0800)/",
            DocumentSize: 0,
            IsPage: false,
            AnchorCount: 0,
            TotalChildUrlCount: 0,
          },
        }),
      );
      const { createBingClient } = await import("./bingClient");

      const info = await createBingClient({ mode: "oauth", userId: "u1" }).getUrlInfo(
        "https://example.com/",
        "https://example.com/never-seen",
      );

      expect(info).toMatchObject({
        known: false,
        discoveredAt: null,
        lastCrawledAt: null,
      });
    });
  });

  describe("getConnectedEmail", () => {
    it("reads the email claim off the access token without a network call", async () => {
      mocks.getAccessToken.mockResolvedValue({
        accessToken: accessToken({
          webmasteruid: "uid-1",
          webmasteremail: "owner@example.com",
        }),
      });
      const { createBingClient } = await import("./bingClient");

      await expect(
        createBingClient({ mode: "oauth", userId: "u1" }).getConnectedEmail(),
      ).resolves.toBe("owner@example.com");
      // Bing has no userinfo endpoint — nothing should be fetched.
      expect(mocks.fetch).not.toHaveBeenCalled();
    });

    it("returns null when the token carries no email claim", async () => {
      mocks.getAccessToken.mockResolvedValue({
        accessToken: accessToken({ webmasteruid: "uid-1" }),
      });
      const { createBingClient } = await import("./bingClient");

      await expect(
        createBingClient({ mode: "oauth", userId: "u1" }).getConnectedEmail(),
      ).resolves.toBeNull();
    });

    it("returns null when the token cannot be decoded", async () => {
      mocks.getAccessToken.mockResolvedValue({ accessToken: "opaque-token" });
      const { createBingClient } = await import("./bingClient");

      await expect(
        createBingClient({ mode: "oauth", userId: "u1" }).getConnectedEmail(),
      ).resolves.toBeNull();
    });
  });
});

describe("parseWcfDate", () => {
  it("parses a real WCF /Date(ms)/ value", async () => {
    const { parseWcfDate } = await import("./bingClient");
    const date = parseWcfDate("/Date(1445558400000)/");
    expect(date).toBeInstanceOf(Date);
    expect(date?.getTime()).toBe(1445558400000);
  });

  it("parses a WCF value carrying a timezone offset", async () => {
    const { parseWcfDate } = await import("./bingClient");
    const date = parseWcfDate("/Date(1445558400000+0000)/");
    expect(date?.getTime()).toBe(1445558400000);
  });

  it("returns null for junk and non-string input", async () => {
    const { parseWcfDate } = await import("./bingClient");
    expect(parseWcfDate("not a date")).toBeNull();
    expect(parseWcfDate("/Date(abc)/")).toBeNull();
    expect(parseWcfDate("2026-01-01")).toBeNull();
    expect(parseWcfDate(1445558400000)).toBeNull();
    expect(parseWcfDate(null)).toBeNull();
    expect(parseWcfDate(undefined)).toBeNull();
  });
});
