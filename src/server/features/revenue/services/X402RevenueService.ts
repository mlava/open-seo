import { z } from "zod";
import {
  X402WalletRepository,
  type X402Wallet,
} from "@/server/features/revenue/repositories/X402WalletRepository";

/**
 * x402 pay-per-call revenue, read straight off the chain. x402 settles each
 * payment as a USDC transfer on Base to the seller's payTo wallet, so the
 * wallet's inbound USDC transfers are the ledger — polled from Blockscout's
 * keyless public API, no credential. Counts and amounts only: payer
 * addresses are never parsed. Every inbound USDC transfer counts, so the
 * wallet should be one dedicated to x402 receipts.
 */

/** Thrown when a project has no x402 wallet. */
export class X402NotConnectedError extends Error {
  constructor(public readonly projectId: string) {
    super("x402 is not connected for this project");
    this.name = "X402NotConnectedError";
  }
}

const BLOCKSCOUT_API = "https://base.blockscout.com/api/v2";
// Circle's native USDC on Base mainnet — the asset x402 sellers price in.
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
// USDC has 6 decimals, so 10,000 atomic units make one cent.
const ATOMIC_PER_CENT = 10_000;
const WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
// 50 transfers per page. The cap bounds Worker subrequests; hitting it
// before covering both windows marks the report truncated.
const MAX_PAGES = 20;
const RECENT_LIMIT = 10;

const transfersPageSchema = z.object({
  items: z.array(
    z.object({
      timestamp: z.string(),
      transaction_hash: z.string(),
      total: z.object({ value: z.string() }),
    }),
  ),
  next_page_params: z
    .record(z.string(), z.union([z.string(), z.number()]))
    .nullable(),
});

type X402Transfer = {
  /** ISO timestamp of the settling block. */
  timestamp: string;
  transactionHash: string;
  /** USDC atomic units (6 decimals). */
  amountAtomic: number;
};

type X402RevenueReport = {
  walletAddress: string;
  paymentsLast30: number;
  paymentsPrev30: number;
  /** USD cents. */
  revenueLast30UsdMinor: number;
  revenuePrev30UsdMinor: number;
  /** Newest first. amountUsdMinor keeps sub-cent precision (e.g. 0.5). */
  recent: Array<{
    timestamp: string;
    transactionHash: string;
    amountUsdMinor: number;
  }>;
  /** True when the page cap was hit before both windows were covered. */
  truncated: boolean;
};

/** Inbound USDC transfers, newest first, back to `since`. */
async function fetchTransfers(
  walletAddress: string,
  since: number,
): Promise<{ transfers: X402Transfer[]; truncated: boolean }> {
  const transfers: X402Transfer[] = [];
  let pageParams: Record<string, string | number> | null = {};
  for (let page = 0; page < MAX_PAGES && pageParams; page++) {
    const url = new URL(
      `${BLOCKSCOUT_API}/addresses/${walletAddress}/token-transfers`,
    );
    url.searchParams.set("type", "ERC-20");
    url.searchParams.set("filter", "to");
    url.searchParams.set("token", USDC_BASE);
    for (const [key, value] of Object.entries(pageParams)) {
      url.searchParams.set(key, String(value));
    }
    const response = await fetch(url, {
      headers: { accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error(`Blockscout responded ${response.status}`);
    }
    const parsed = transfersPageSchema.parse(await response.json());
    for (const item of parsed.items) {
      if (Date.parse(item.timestamp) < since) {
        return { transfers, truncated: false };
      }
      transfers.push({
        timestamp: item.timestamp,
        transactionHash: item.transaction_hash,
        amountAtomic: Number(item.total.value),
      });
    }
    pageParams = parsed.next_page_params;
  }
  return { transfers, truncated: pageParams !== null };
}

/** Last-30 vs prior-30 windows over the transfers — exported for tests. */
export function buildX402Report(
  walletAddress: string,
  transfers: X402Transfer[],
  now: number,
  truncated = false,
): X402RevenueReport {
  const window = (from: number, to: number) => {
    const inWindow = transfers.filter((transfer) => {
      const at = Date.parse(transfer.timestamp);
      return at >= from && at < to;
    });
    const atomic = inWindow.reduce((sum, t) => sum + t.amountAtomic, 0);
    return {
      payments: inWindow.length,
      usdMinor: Math.round(atomic / ATOMIC_PER_CENT),
    };
  };
  const last = window(now - WINDOW_MS, now + 1);
  const prev = window(now - 2 * WINDOW_MS, now - WINDOW_MS);
  return {
    walletAddress,
    paymentsLast30: last.payments,
    paymentsPrev30: prev.payments,
    revenueLast30UsdMinor: last.usdMinor,
    revenuePrev30UsdMinor: prev.usdMinor,
    recent: transfers.slice(0, RECENT_LIMIT).map((transfer) => ({
      timestamp: transfer.timestamp,
      transactionHash: transfer.transactionHash,
      amountUsdMinor: transfer.amountAtomic / ATOMIC_PER_CENT,
    })),
    truncated,
  };
}

async function getWallet(projectId: string): Promise<X402Wallet | null> {
  return X402WalletRepository.getByProjectId(projectId);
}

async function setWallet(input: {
  projectId: string;
  organizationId: string;
  walletAddress: string;
  userId: string;
}): Promise<X402Wallet> {
  return X402WalletRepository.upsert({
    projectId: input.projectId,
    organizationId: input.organizationId,
    walletAddress: input.walletAddress,
    connectedByUserId: input.userId,
  });
}

async function disconnect(projectId: string): Promise<void> {
  await X402WalletRepository.deleteByProjectId(projectId);
}

async function getRevenue(input: {
  projectId: string;
}): Promise<X402RevenueReport> {
  const wallet = await X402WalletRepository.getByProjectId(input.projectId);
  if (!wallet) throw new X402NotConnectedError(input.projectId);
  const now = Date.now();
  const { transfers, truncated } = await fetchTransfers(
    wallet.walletAddress,
    now - 2 * WINDOW_MS,
  );
  return buildX402Report(wallet.walletAddress, transfers, now, truncated);
}

export const X402RevenueService = {
  getWallet,
  setWallet,
  disconnect,
  getRevenue,
};
