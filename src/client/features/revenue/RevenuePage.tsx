import { useQuery } from "@tanstack/react-query";
import { RapidapiSnapshotsPanel } from "@/client/features/revenue/RapidapiSnapshotsPanel";
import { StripeConnectionCard } from "@/client/features/revenue/StripeConnectionCard";
import {
  DeltaTile,
  formatMoney,
  PanelError,
  PanelLoading,
  StatTile,
} from "@/client/features/revenue/revenueParts";
import { getProjects } from "@/serverFunctions/projects";
import { getStripeRevenue } from "@/serverFunctions/stripe";
import { getX402Revenue } from "@/serverFunctions/x402";

/**
 * Revenue for this project from two sources: Stripe (live, a subscription
 * product and/or a one-off purchase product, last 30 days vs prior 30) and
 * RapidAPI (manually-logged subscriber snapshots — RapidAPI has no platform
 * API for public-marketplace subscriber data, per support 2026-08-04).
 * Deliberately PII-free — counts and amounts only. RapidAPI is optional per
 * project (projects.rapidapiEnabled, toggled in project settings) for
 * projects with no RapidAPI marketplace listing. x402 (on-chain USDC
 * payments into the project's wallet) is optional too — its panel appears
 * once a wallet is set in project settings. See specs/0014.
 */
export function RevenuePage({ projectId }: { projectId: string }) {
  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: () => getProjects(),
  });
  // Undetermined while loading defaults to shown — only an explicit `false`
  // (loaded and off) hides the panel, so it never flashes and disappears.
  const rapidapiEnabled =
    projectsQuery.data?.find((project) => project.id === projectId)
      ?.rapidapiEnabled !== false;
  // Same key as X402Panel — one call, shared cache.
  const x402Query = useQuery({
    queryKey: ["x402Revenue", projectId],
    queryFn: () => getX402Revenue({ data: { projectId } }),
  });
  const sources = [
    "Stripe",
    ...(rapidapiEnabled ? ["RapidAPI"] : []),
    ...(x402Query.data?.connected ? ["x402"] : []),
  ];

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-semibold">Revenue</h1>
        <p className="text-sm text-base-content/70">
          Subscribers, churn, and purchases from{" "}
          {new Intl.ListFormat("en").format(sources)}.
        </p>
      </div>
      <StripePanel projectId={projectId} />
      {rapidapiEnabled ? (
        <RapidapiSnapshotsPanel projectId={projectId} />
      ) : null}
      <X402Panel projectId={projectId} />
    </div>
  );
}

/** Renders nothing until a wallet is connected — setting one in project
 *  settings is what opts a project into x402. */
function X402Panel({ projectId }: { projectId: string }) {
  const query = useQuery({
    queryKey: ["x402Revenue", projectId],
    queryFn: () => getX402Revenue({ data: { projectId } }),
  });
  const data = query.data;
  if (query.isLoading || (data && !data.connected)) return null;

  const money = (amount: number) => formatMoney(amount, "usd", 2);
  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold">x402</h2>
      {query.isError || !data?.connected ? (
        <PanelError onRetry={() => void query.refetch()} />
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-base-content/60">
            <span className="font-mono">
              {data.walletAddress.slice(0, 6)}…{data.walletAddress.slice(-4)}
            </span>{" "}
            · USDC on Base · last 30 days vs prior 30
          </p>
          <div className="grid grid-cols-2 gap-3 lg:max-w-xl">
            <DeltaTile
              label="Payments (30d)"
              value={data.paymentsLast30}
              previous={data.paymentsPrev30}
            />
            <DeltaTile
              label="Revenue (30d)"
              value={data.revenueLast30UsdMinor}
              previous={data.revenuePrev30UsdMinor}
              format={money}
            />
          </div>
          {data.truncated ? (
            <p className="text-xs text-base-content/50">
              Too many payments to read in one pass — these figures undercount.
            </p>
          ) : null}
          {data.recent.length > 0 ? (
            <div className="overflow-x-auto lg:max-w-xl">
              <table className="table table-sm">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th className="text-right">Amount</th>
                    <th>Transaction</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recent.map((payment) => (
                    <tr key={payment.transactionHash}>
                      <td>{payment.timestamp.slice(0, 10)}</td>
                      <td className="text-right tabular-nums">
                        {money(payment.amountUsdMinor)}
                      </td>
                      <td>
                        <a
                          href={`https://basescan.org/tx/${payment.transactionHash}`}
                          target="_blank"
                          rel="noreferrer"
                          className="link font-mono text-xs"
                        >
                          {payment.transactionHash.slice(0, 10)}…
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}

function StripePanel({ projectId }: { projectId: string }) {
  const query = useQuery({
    queryKey: ["stripeRevenue", projectId],
    queryFn: () => getStripeRevenue({ data: { projectId } }),
  });
  const data = query.data;

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold">Stripe</h2>
      {query.isLoading ? (
        <PanelLoading label="Loading Stripe revenue…" />
      ) : query.isError ? (
        <PanelError onRetry={() => void query.refetch()} />
      ) : !data?.connected ? (
        <div className="max-w-2xl">
          <StripeConnectionCard projectId={projectId} />
        </div>
      ) : (
        <div className="space-y-6">
          {data.subscription ? (
            <div className="space-y-3">
              <p className="text-sm text-base-content/60">
                <span className="font-mono">
                  {data.subscription.productName ?? data.subscription.productId}
                </span>{" "}
                · subscriptions · last 30 days vs prior 30
              </p>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <StatTile
                  label="Active subscribers"
                  value={String(data.subscription.activeSubscribers)}
                />
                <StatTile
                  label="Est. MRR"
                  value={
                    data.subscription.mrr
                      ? formatMoney(
                          data.subscription.mrr.amount,
                          data.subscription.mrr.currency,
                        )
                      : "—"
                  }
                />
                <DeltaTile
                  label="New (30d)"
                  value={data.subscription.newLast30}
                  previous={data.subscription.newPrev30}
                />
                <DeltaTile
                  label="Churned (30d)"
                  value={data.subscription.churnedLast30}
                  previous={data.subscription.churnedPrev30}
                  betterWhenLower
                />
              </div>
            </div>
          ) : null}
          {data.oneOff ? <OneOffTiles oneOff={data.oneOff} /> : null}
        </div>
      )}
    </section>
  );
}

function OneOffTiles({
  oneOff,
}: {
  oneOff: {
    productId: string;
    productName: string | null;
    purchasesLast30: number;
    purchasesPrev30: number;
    revenueLast30: number;
    revenuePrev30: number;
    currency: string | null;
    refunds: {
      refundsLast30: number;
      refundsPrev30: number;
      refundAmountLast30: number;
      refundAmountPrev30: number;
    } | null;
  };
}) {
  const money = (amount: number) =>
    oneOff.currency ? formatMoney(amount, oneOff.currency) : String(amount);
  const { refunds } = oneOff;
  return (
    <div className="space-y-3">
      <p className="text-sm text-base-content/60">
        <span className="font-mono">
          {oneOff.productName ?? oneOff.productId}
        </span>{" "}
        · one-off purchases · last 30 days vs prior 30
      </p>
      <div
        className={`grid grid-cols-2 gap-3 ${refunds ? "lg:grid-cols-4" : "lg:max-w-xl"}`}
      >
        <DeltaTile
          label="Purchases (30d)"
          value={oneOff.purchasesLast30}
          previous={oneOff.purchasesPrev30}
        />
        <DeltaTile
          label="Gross revenue (30d)"
          value={oneOff.revenueLast30}
          previous={oneOff.revenuePrev30}
          format={money}
        />
        {refunds ? (
          <>
            <DeltaTile
              label="Refunds (30d)"
              value={refunds.refundAmountLast30}
              previous={refunds.refundAmountPrev30}
              betterWhenLower
              format={money}
            />
            <DeltaTile
              label="Net revenue (30d)"
              value={oneOff.revenueLast30 - refunds.refundAmountLast30}
              previous={oneOff.revenuePrev30 - refunds.refundAmountPrev30}
              format={money}
            />
          </>
        ) : null}
      </div>
      {refunds ? null : (
        <p className="text-xs text-base-content/50">
          Refunds and net revenue need Refunds read access on STRIPE_SECRET_KEY.
        </p>
      )}
    </div>
  );
}
