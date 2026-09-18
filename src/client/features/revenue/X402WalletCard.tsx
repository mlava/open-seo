import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Wallet } from "lucide-react";
import { toast } from "sonner";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import {
  ConnectedState,
  IntegrationCard,
} from "@/client/features/integrations/integrationCardParts";
import {
  disconnectX402,
  getX402Wallet,
  setX402Wallet,
} from "@/serverFunctions/x402";

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

/**
 * x402 revenue connection. x402 settles on-chain, so connecting is just
 * naming the public payTo wallet — no credential. Optional per project: the
 * Revenue page and dashboard only show x402 once a wallet is set.
 */
export function X402WalletCard({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = React.useState(false);
  const [address, setAddress] = React.useState("");

  const walletKey = ["x402Wallet", projectId];
  const walletQuery = useQuery({
    queryKey: walletKey,
    queryFn: () => getX402Wallet({ data: { projectId } }),
  });
  const wallet = walletQuery.data;
  const connected = Boolean(wallet?.connected);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: walletKey });
    void queryClient.invalidateQueries({
      queryKey: ["x402Revenue", projectId],
    });
  };

  const setMutation = useMutation({
    mutationFn: () =>
      setX402Wallet({ data: { projectId, walletAddress: address.trim() } }),
    onSuccess: () => {
      toast.success("x402 wallet saved");
      setEditing(false);
      invalidate();
    },
    onError: (error) => toast.error(getStandardErrorMessage(error)),
  });

  const disconnectMutation = useMutation({
    mutationFn: () => disconnectX402({ data: { projectId } }),
    onSuccess: () => {
      toast.success("x402 wallet removed");
      setEditing(false);
      setAddress("");
      invalidate();
    },
    onError: (error) => toast.error(getStandardErrorMessage(error)),
  });

  return (
    <IntegrationCard
      title="x402 payments"
      status={
        walletQuery.isLoading
          ? undefined
          : connected
            ? "connected"
            : "disconnected"
      }
    >
      {walletQuery.isLoading ? (
        <div className="flex items-center gap-2 text-sm text-base-content/50">
          <span className="loading loading-spinner loading-sm" />
          Checking…
        </div>
      ) : connected && !editing ? (
        <ConnectedState
          glyph={<Wallet className="size-[18px] text-base-content/70" />}
          changeLabel="Change wallet"
          siteUrl={wallet?.walletAddress ?? ""}
          connectedByEmail={null}
          onChange={() => {
            setAddress(wallet?.walletAddress ?? "");
            setEditing(true);
          }}
          onDisconnect={() => disconnectMutation.mutate()}
          disconnecting={disconnectMutation.isPending}
        />
      ) : (
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            setMutation.mutate();
          }}
        >
          <p className="text-sm text-base-content/70">
            If this project sells through x402, enter the wallet that receives
            the payments (your payTo address). Revenue is read from its inbound
            USDC transfers on Base — no API key needed. Leave unset to keep x402
            off the Revenue page.
          </p>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">Receiving wallet</span>
            <input
              type="text"
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              placeholder="0x…"
              className="input input-bordered w-full font-mono text-xs"
            />
            <span className="text-xs text-base-content/50">
              Every inbound USDC transfer counts as a payment, so use a wallet
              dedicated to x402 receipts.
            </span>
          </label>
          <div className="flex items-center gap-2">
            <button
              type="submit"
              className="btn btn-primary btn-sm"
              disabled={
                !ADDRESS_PATTERN.test(address.trim()) || setMutation.isPending
              }
            >
              {setMutation.isPending ? "Saving…" : "Save"}
            </button>
            {connected ? (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setEditing(false)}
              >
                Cancel
              </button>
            ) : null}
          </div>
        </form>
      )}
    </IntegrationCard>
  );
}
