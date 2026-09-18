import { describe, expect, it, vi } from "vitest";
import { buildX402Report } from "./X402RevenueService";

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/server/features/revenue/repositories/X402WalletRepository", () => ({
  X402WalletRepository: {},
}));

const NOW = Date.parse("2026-09-18T00:00:00Z");
const transfer = (timestamp: string, amountAtomic: number) => ({
  timestamp,
  transactionHash: `0x${timestamp}`,
  amountAtomic,
});

describe("buildX402Report", () => {
  it("splits payments into the last 30 days and the prior 30", () => {
    const report = buildX402Report(
      "0xwallet",
      [
        transfer("2026-09-17T03:43:35Z", 20_000),
        transfer("2026-09-02T03:38:45Z", 250_000),
        transfer("2026-07-30T07:01:01Z", 20_000),
        // Older than both windows — ignored.
        transfer("2026-07-12T00:41:51Z", 20_000),
      ],
      NOW,
    );

    expect(report).toMatchObject({
      paymentsLast30: 2,
      revenueLast30UsdMinor: 27,
      paymentsPrev30: 1,
      revenuePrev30UsdMinor: 2,
    });
  });

  it("sums sub-cent payments before rounding to cents", () => {
    const report = buildX402Report(
      "0xwallet",
      [
        transfer("2026-09-17T00:00:00Z", 5_000),
        transfer("2026-09-16T00:00:00Z", 5_000),
      ],
      NOW,
    );

    expect(report.revenueLast30UsdMinor).toBe(1);
  });
});
