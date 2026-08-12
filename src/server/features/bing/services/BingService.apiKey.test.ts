import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  type BingSite = {
    url: string;
    isVerified: boolean;
    authenticationCode: string | null;
    dnsVerificationCode: string | null;
  };
  const listSites = vi.fn<() => Promise<BingSite[]>>();
  return {
    listSites,
    createBingClient: vi.fn(() => ({ listSites })),
    upsert: vi.fn(),
    encryptBingApiKey: vi.fn(),
  };
});

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/server/lib/bingClient", () => ({
  createBingClient: mocks.createBingClient,
  BingApiError: class extends Error {},
  BingTokenError: class extends Error {},
  describeBingFailure: (error: unknown) => String(error),
}));
vi.mock("@/server/features/bing/apiKeyCrypto", () => ({
  decryptBingApiKey: vi.fn().mockResolvedValue("plain-key"),
  encryptBingApiKey: mocks.encryptBingApiKey,
}));
vi.mock("@/server/features/bing/repositories/BingConnectionRepository", () => ({
  BingConnectionRepository: { upsert: mocks.upsert },
}));

const verifiedSite = {
  url: "https://x.example/",
  isVerified: true,
  authenticationCode: null,
  dnsVerificationCode: null,
};

function resetClientMocks() {
  mocks.listSites.mockReset();
}

describe("BingService.setSiteWithApiKey", () => {
  beforeEach(() => {
    resetClientMocks();
    mocks.createBingClient.mockClear();
    mocks.upsert.mockReset();
    mocks.encryptBingApiKey.mockResolvedValue("cipher");
  });

  it("stores the encrypted key and no account identity", async () => {
    mocks.listSites.mockResolvedValue([verifiedSite]);
    mocks.upsert.mockResolvedValue({ siteUrl: "https://x.example/" });
    const { BingService } = await import("./BingService");

    await BingService.setSiteWithApiKey({
      projectId: "p1",
      organizationId: "org1",
      siteUrl: "https://x.example/",
      apiKey: "plain-key",
      userId: "u1",
    });

    expect(mocks.encryptBingApiKey).toHaveBeenCalledWith("plain-key");
    expect(mocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        authMode: "api_key",
        apiKeyEncrypted: "cipher",
        // A key is account-wide and carries no webmasteruid or email claim.
        bingAccountId: null,
        connectedAccountEmail: null,
      }),
    );
    // The plaintext must never reach the repository.
    expect(JSON.stringify(mocks.upsert.mock.calls)).not.toContain("plain-key");
  });

  it("rejects an unverified site with FORBIDDEN", async () => {
    mocks.listSites.mockResolvedValue([{ ...verifiedSite, isVerified: false }]);
    const { BingService } = await import("./BingService");

    await expect(
      BingService.setSiteWithApiKey({
        projectId: "p1",
        organizationId: "org1",
        siteUrl: "https://x.example/",
        apiKey: "plain-key",
        userId: "u1",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("rejects a site the key cannot see with NOT_FOUND", async () => {
    mocks.listSites.mockResolvedValue([verifiedSite]);
    const { BingService } = await import("./BingService");

    await expect(
      BingService.setSiteWithApiKey({
        projectId: "p1",
        organizationId: "org1",
        siteUrl: "https://not-mine/",
        apiKey: "plain-key",
        userId: "u1",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
});
