import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  X402RevenueService,
  X402NotConnectedError,
} from "@/server/features/revenue/services/X402RevenueService";
import { requireProjectContext } from "@/serverFunctions/middleware";

const projectScopedSchema = z.object({ projectId: z.string().min(1) });
const setWalletSchema = projectScopedSchema.extend({
  walletAddress: z
    .string()
    .trim()
    .regex(/^0x[0-9a-fA-F]{40}$/, "Enter a 0x… wallet address"),
});

export const getX402Wallet = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectScopedSchema)
  .handler(async ({ context }) => {
    const wallet = await X402RevenueService.getWallet(context.projectId);
    return {
      connected: Boolean(wallet),
      walletAddress: wallet?.walletAddress ?? null,
    };
  });

export const setX402Wallet = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(setWalletSchema)
  .handler(async ({ data, context }) => {
    const wallet = await X402RevenueService.setWallet({
      projectId: context.projectId,
      organizationId: context.organizationId,
      walletAddress: data.walletAddress,
      userId: context.userId,
    });
    return { connected: true as const, walletAddress: wallet.walletAddress };
  });

export const disconnectX402 = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectScopedSchema)
  .handler(async ({ context }) => {
    await X402RevenueService.disconnect(context.projectId);
    return { connected: false as const };
  });

/**
 * x402 payments into the project's wallet, last 30 days vs prior 30. No
 * wallet resolves to { connected: false } — the Revenue page and dashboard
 * simply leave x402 out, since connecting a wallet is what opts a project in.
 */
export const getX402Revenue = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectScopedSchema)
  .handler(async ({ context }) => {
    try {
      const report = await X402RevenueService.getRevenue({
        projectId: context.projectId,
      });
      return { connected: true as const, ...report };
    } catch (error) {
      if (error instanceof X402NotConnectedError) {
        return { connected: false as const };
      }
      throw error;
    }
  });
