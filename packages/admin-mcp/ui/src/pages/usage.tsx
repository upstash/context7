import { useEffect, useState, type ReactNode } from "react";
import { DailyBars, SERIES, Sparkline } from "../charts";
import {
  Card,
  ErrorNote,
  Loaded,
  Meter,
  Metric,
  Metrics,
  MetricsSkeleton,
  Segmented,
  Skeleton,
} from "../components";
import { useTool, type TeamspaceDetails, type Usage } from "../data";
import { fillDays, num, pct, usd } from "../format";
import { host } from "../host";

/**
 * The month's numbers as the dashboard counts them (context7app StatsCard): requests are the
 * calling user's against their monthly quota, or the billed requests on pay as you go, which has
 * no quota. A teamspace without a spending cap has no `limitCents` (results carry no nulls).
 */
function summarize(usage: Usage, details: { data?: TeamspaceDetails; error?: string }) {
  const payg = usage.billingModel === "payg";
  const days = fillDays(
    usage.dailyStats,
    (date) => ({
      date,
      searchRequests: 0,
      fetchDocsRequests: 0,
      parseTokensCost: 0,
      memberCost: 0,
      apiUsageCost: 0,
    }),
    30
  );
  return {
    payg,
    requests: payg ? (usage.billedRequests ?? 0) : (usage.userRequests ?? 0),
    quota: payg ? 0 : usage.quotaLimit,
    spend: details.data?.spendingLimit,
    spendFailed: Boolean(details.error),
    days,
  };
}

function useUsage(teamspace: string) {
  return {
    usage: useTool<Usage>("get_teamspace_usage", { teamspace }),
    details: useTool<TeamspaceDetails>("get_teamspace", { teamspace }),
  };
}

const planName = (usage: Usage) =>
  `${usage.ownerPlan[0]?.toUpperCase()}${usage.ownerPlan.slice(1)}`;
const billing = (usage: Usage) => (usage.billingModel === "payg" ? "Pay as you go" : "Per seat");

export function UsageSummary({ teamspace }: { teamspace: string }) {
  const { usage, details } = useUsage(teamspace);
  return (
    <Loaded result={usage} skeleton={<MetricsSkeleton chart={false} />}>
      {(u) => {
        const { payg, requests, quota, spend, spendFailed, days } = summarize(u, details);
        return (
          <div className="grid gap-8">
            <Metrics>
              <Metric
                label="Spend"
                value={
                  spend ? (
                    usd(spend.currentSpendCents / 100)
                  ) : spendFailed ? (
                    "–"
                  ) : (
                    <Skeleton className="h-6 w-16" />
                  )
                }
                hint={
                  spend &&
                  (spend.limitCents == null ? "No cap" : `of ${usd(spend.limitCents / 100)} cap`)
                }
              />
              <Metric
                label="Requests"
                value={num(requests)}
                hint={
                  quota
                    ? `Yours, ${pct(requests, quota)} of ${num(quota)}`
                    : payg
                      ? "Billed"
                      : undefined
                }
              />
              <Metric label="Credit" value={usd(u.creditBalance)} />
              <Metric label="Plan" value={planName(u)} hint={billing(u)} />
            </Metrics>
            {details.error && <ErrorNote message={details.error} onRetry={details.reload} />}
            {spend?.limitCents ? (
              <Meter
                value={spend.currentSpendCents}
                max={spend.limitCents}
                label="Spend against the cap"
              />
            ) : (
              <Sparkline values={days.map((d) => d.searchRequests + d.fetchDocsRequests)} />
            )}
          </div>
        );
      }}
    </Loaded>
  );
}

export function UsagePage({ teamspace }: { teamspace: string }) {
  const { usage, details } = useUsage(teamspace);
  const [metric, setMetric] = useState<"requests" | "cost">("requests");
  useEffect(() => {
    host.setModelContext(
      `The user is looking at usage and spend of teamspace ${teamspace} in the Context7 console.`
    );
  }, [teamspace]);

  return (
    <Loaded result={usage} skeleton={<MetricsSkeleton />}>
      {(u) => {
        const { payg, requests, quota, spend, days } = summarize(u, details);
        const cap = spend?.limitCents;
        return (
          <div className="grid gap-8">
            <Card title="This month">
              <Metrics>
                <Metric
                  label="Spend"
                  value={spend ? usd(spend.currentSpendCents / 100) : "–"}
                  hint={spend && (cap == null ? "No spending cap" : `Cap ${usd(cap / 100)}`)}
                />
                <Metric
                  label="Requests"
                  value={num(requests)}
                  hint={
                    quota ? `Yours, quota ${num(quota)}` : payg ? "Billed, no quota" : undefined
                  }
                />
                <Metric label="Credit" value={usd(u.creditBalance)} />
                <Metric label="Plan" value={planName(u)} hint={billing(u)} />
              </Metrics>
              {details.error && (
                <div className="mt-8">
                  <ErrorNote message={details.error} onRetry={details.reload} />
                </div>
              )}
              {(cap || quota > 0) && (
                <div className="mt-8 grid gap-8 @lg:grid-cols-2">
                  {cap ? (
                    <MeterRow
                      label="Spending cap"
                      value={`${usd(spend!.currentSpendCents / 100)} of ${usd(cap / 100)}`}
                      meter={
                        <Meter
                          value={spend!.currentSpendCents}
                          max={cap}
                          label="Spend against the cap"
                        />
                      }
                    />
                  ) : null}
                  {quota > 0 && (
                    <MeterRow
                      label="Your monthly quota"
                      value={`${num(requests)} of ${num(quota)}`}
                      meter={
                        <Meter
                          value={requests}
                          max={quota}
                          label="Your requests against the quota"
                        />
                      }
                    />
                  )}
                </div>
              )}
            </Card>
            <Card
              title="Last 30 days"
              action={
                <Segmented
                  label="Metric"
                  value={metric}
                  onChange={setMetric}
                  options={[
                    { value: "requests", label: "Requests" },
                    { value: "cost", label: "Cost" },
                  ]}
                />
              }
            >
              {metric === "requests" ? (
                <DailyBars
                  format={num}
                  series={[
                    { name: "Search", color: SERIES[0]! },
                    { name: "Docs", color: SERIES[1]! },
                  ]}
                  points={days.map((d) => ({
                    date: d.date,
                    values: [d.searchRequests, d.fetchDocsRequests],
                  }))}
                />
              ) : (
                <DailyBars
                  format={usd}
                  series={[
                    { name: "Usage", color: SERIES[0]! },
                    { name: "Seats", color: SERIES[1]! },
                  ]}
                  points={days.map((d) => ({
                    date: d.date,
                    values: [d.apiUsageCost + d.parseTokensCost, d.memberCost],
                  }))}
                />
              )}
            </Card>
          </div>
        );
      }}
    </Loaded>
  );
}

function MeterRow({ label, value, meter }: { label: string; value: string; meter: ReactNode }) {
  return (
    <div className="grid gap-2">
      <div className="flex justify-between gap-3 text-xs">
        <span className="text-fg-3">{label}</span>
        <span className="text-fg-2 tabular-nums">{value}</span>
      </div>
      {meter}
    </div>
  );
}
