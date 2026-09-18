import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { x402Wallets } from "@/db/schema";

export type X402Wallet = typeof x402Wallets.$inferSelect;

async function getByProjectId(projectId: string): Promise<X402Wallet | null> {
  const rows = await db
    .select()
    .from(x402Wallets)
    .where(eq(x402Wallets.projectId, projectId))
    .limit(1);
  return rows[0] ?? null;
}

async function upsert(input: {
  projectId: string;
  organizationId: string;
  walletAddress: string;
  connectedByUserId: string;
}): Promise<X402Wallet> {
  const [row] = await db
    .insert(x402Wallets)
    .values({ id: crypto.randomUUID(), ...input })
    .onConflictDoUpdate({
      target: x402Wallets.projectId,
      set: {
        organizationId: input.organizationId,
        walletAddress: input.walletAddress,
        connectedByUserId: input.connectedByUserId,
        updatedAt: sql`(current_timestamp)`,
      },
    })
    .returning();
  if (!row) {
    throw new Error("Failed to upsert x402_wallet");
  }
  return row;
}

async function deleteByProjectId(projectId: string): Promise<void> {
  await db.delete(x402Wallets).where(eq(x402Wallets.projectId, projectId));
}

export const X402WalletRepository = {
  getByProjectId,
  upsert,
  deleteByProjectId,
};
