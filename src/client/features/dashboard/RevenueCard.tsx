import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  CardShell,
  EmptyCardBody,
  moreDetailsClass,
  PercentDelta,
  Stat,
} from "@/client/features/dashboard/cardParts";
import { formatMoney } from "@/client/features/revenue/revenueParts";
import { getRapidapiSnapshots } from "@/serverFunctions/rapidapi";
import { getStripeRevenue } from "@/serverFunctions/stripe";
import { getX402Revenue } from "@/serverFunctions/x402";

/** The MRR tile's value and breakdown across both recurring sources. Stripe
 *  and RapidAPI are only summed when Stripe's currency is USD (RapidAPI
 *  bills USD only); a non-USD Stripe MRR keeps its own value with the
 *  RapidAPI figure noted alongside instead of a cross-currency sum. */
function buildMrr(
  stripeMrr: { amount: number; currency: string } | null,
  rapidapiNetUsdMinor: number | null,
): { value: string; note: string | null } | null {
  if (stripeMrr && rapidapiNetUsdMinor !== null) {
    if (stripeMrr.currency.toLowerCase() === "usd") {
      return {
        value: formatMoney(stripeMrr.amount + rapidapiNetUsdMinor, "usd"),
        note: `Stripe ${formatMoney(stripeMrr.amount, "usd")} + RapidAPI ${formatMoney(rapidapiNetUsdMinor, "usd")} net`,
      };
    }
    return {
      value: formatMoney(stripeMrr.amount, stripeMrr.currency),
      note: `+ ${formatMoney(rapidapiNetUsdMinor, "usd")} RapidAPI net`,
    };
  }
  if (stripeMrr) {
    return {
      value: formatMoney(stripeMrr.amount, stripeMrr.currency),
      note: null,
    };
  }
  if (rapidapiNetUsdMinor !== null) {
    return {
      value: formatMoney(rapidapiNetUsdMinor, "usd"),
      note: "RapidAPI · net of 25% fee",
    };
  }
  return null;
}

export function RevenueCard({ projectId }: { projectId: string }) {
  // Same keys as the Revenue page's panels — identical calls, shared caches.
  const revenueQuery = useQuery({
    queryKey: ["stripeRevenue", projectId],
    queryFn: () => getStripeRevenue({ data: { projectId } }),
  });
  const rapidapiQuery = useQuery({
    queryKey: ["rapidapiSnapshots", projectId],
    queryFn: () => getRapidapiSnapshots({ data: { projectId } }),
  });
  const x402Query = useQuery({
    queryKey: ["x402Revenue", projectId],
    queryFn: () => getX402Revenue({ data: { projectId } }),
  });
  const data = revenueQuery.data;
  // Like RapidAPI, an x402 failure (or no wallet) only drops its own tile.
  const x402 = x402Query.data?.connected ? x402Query.data : null;
  // A RapidAPI fetch failure only costs its MRR contribution — the card
  // still renders the Stripe numbers.
  const rapidapiNet = rapidapiQuery.data?.report.netMrrUsdMinor ?? null;

  const subscription = data?.connected ? data.subscription : null;
  const oneOff = data?.connected ? data.oneOff : null;
  const mrr = buildMrr(subscription?.mrr ?? null, rapidapiNet);

  // The Stripe pitch only when RapidAPI has nothing to show either (wait for
  // its query so the pitch doesn't flash before an MRR-bearing snapshot).
  if (
    data &&
    !data.connected &&
    !rapidapiQuery.isPending &&
    !x402Query.isPending &&
    mrr === null &&
    !x402
  ) {
    return (
      <CardShell title="Revenue">
        <EmptyCardBody
          message="Connect Stripe to see subscribers, MRR and purchases next to your search data."
          cta={
            <Link
              to="/p/$projectId/revenue"
              params={{ projectId }}
              className="btn btn-primary btn-sm"
            >
              Set up revenue
            </Link>
          }
        />
      </CardShell>
    );
  }

  const hasAnything = Boolean(subscription || oneOff || mrr || x402);

  return (
    <CardShell
      title="Revenue"
      stamp={
        hasAnything
          ? `Stripe${rapidapiNet !== null ? " + RapidAPI" : ""}${x402 ? " + x402" : ""} · last 30 days vs prior 30`
          : undefined
      }
      action={
        <Link
          to="/p/$projectId/revenue"
          params={{ projectId }}
          className={moreDetailsClass}
        >
          More details
        </Link>
      }
    >
      {revenueQuery.isPending ||
      rapidapiQuery.isPending ||
      x402Query.isPending ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-busy>
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="skeleton h-20" />
          ))}
        </div>
      ) : revenueQuery.isError ? (
        <p className="text-sm text-base-content/60">
          Couldn&rsquo;t load Stripe revenue. Try again shortly.
        </p>
      ) : !hasAnything ? (
        <p className="text-sm text-base-content/60">
          Pick your Stripe products on the Revenue page to see metrics here.
        </p>
      ) : (
        // Full-width card: the four tiles share one row on large screens.
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {subscription ? (
            <Stat
              label="Subscribers"
              value={subscription.activeSubscribers.toLocaleString()}
            />
          ) : null}
          {mrr ? (
            <Stat
              label="Est. MRR"
              value={mrr.value}
              sub={
                mrr.note ? (
                  <p className="text-xs text-base-content/50">{mrr.note}</p>
                ) : undefined
              }
            />
          ) : null}
          {oneOff ? <OneOffStats oneOff={oneOff} /> : null}
          {x402 ? (
            <Stat
              label="x402 revenue (30d)"
              value={formatMoney(x402.revenueLast30UsdMinor, "usd", 2)}
              sub={
                <PercentDelta
                  current={x402.revenueLast30UsdMinor}
                  previous={x402.revenuePrev30UsdMinor}
                />
              }
            />
          ) : null}
        </div>
      )}
    </CardShell>
  );
}

function OneOffStats({
  oneOff,
}: {
  oneOff: {
    purchasesLast30: number;
    purchasesPrev30: number;
    revenueLast30: number;
    revenuePrev30: number;
    currency: string | null;
    refunds: { refundAmountLast30: number; refundAmountPrev30: number } | null;
  };
}) {
  const { refunds } = oneOff;
  return (
    <>
      <Stat
        label="Purchases (30d)"
        value={oneOff.purchasesLast30.toLocaleString()}
        sub={
          <PercentDelta
            current={oneOff.purchasesLast30}
            previous={oneOff.purchasesPrev30}
          />
        }
      />
      <Stat
        label={refunds ? "Net revenue (30d)" : "Revenue (30d)"}
        value={
          oneOff.currency
            ? formatMoney(
                oneOff.revenueLast30 - (refunds?.refundAmountLast30 ?? 0),
                oneOff.currency,
              )
            : "—"
        }
        sub={
          <PercentDelta
            current={oneOff.revenueLast30 - (refunds?.refundAmountLast30 ?? 0)}
            previous={oneOff.revenuePrev30 - (refunds?.refundAmountPrev30 ?? 0)}
          />
        }
      />
    </>
  );
}
