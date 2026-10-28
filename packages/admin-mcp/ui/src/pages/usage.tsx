import { useEffect, useState, type ReactNode } from "react";
import { DailyBars, SERIES, Sparkline } from "../charts";
import {
  Card,
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

/** This UTC month's requests, every day of the window, and the spend against the cap. */
function summarize(usage: Usage, details?: TeamspaceDetails) {
  const month = new Date().toISOString().slice(0, 7);
  const requests = usage.dailyStats
    .filter((d) => d.date.startsWith(month))
    .reduce((n, d) => n + d.searchRequests + d.fetchDocsRequests, 0);
  const days = fillDays(usage.dailyStats, (date) => ({
    date,
    searchRequests: 0,
    fetchDocsRequests: 0,
    parseTokensCost: 0,
    memberCost: 0,
    apiUsageCost: 0,
  }));
  return { requests, days, spend: details?.spendingLimit };
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
        const { requests, days, spend } = summarize(u, details.data);
        return (
          <div className="grid gap-8">
            <Metrics>
              <Metric
                label="Spend"
                value={
                  spend ? usd(spend.currentSpendCents / 100) : <Skeleton className="h-6 w-16" />
                }
                hint={
                  spend &&
                  (spend.limitCents === null ? "No cap" : `of ${usd(spend.limitCents / 100)} cap`)
                }
              />
              <Metric
                label="Requests"
                value={num(requests)}
                hint={
                  u.quotaLimit
                    ? `${pct(requests, u.quotaLimit)} of ${num(u.quotaLimit)}`
                    : undefined
                }
              />
              <Metric label="Credit" value={usd(u.creditBalance)} />
              <Metric label="Plan" value={planName(u)} hint={billing(u)} />
            </Metrics>
            {spend && spend.limitCents ? (
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

export function UsagePage({ teamspace, name }: { teamspace: string; name: string }) {
  const { usage, details } = useUsage(teamspace);
  const [metric, setMetric] = useState<"requests" | "cost">("requests");
  useEffect(() => {
    host.setModelContext(
      `The user is looking at usage and spend of teamspace "${name}" (${teamspace}) in the Context7 console.`
    );
  }, [teamspace, name]);

  return (
    <Loaded result={usage} skeleton={<MetricsSkeleton />}>
      {(u) => {
        const { requests, days, spend } = summarize(u, details.data);
        return (
          <div className="grid gap-8">
            <Card title="This month">
              <Metrics>
                <Metric
                  label="Spend"
                  value={spend ? usd(spend.currentSpendCents / 100) : "–"}
                  hint={
                    spend &&
                    (spend.limitCents === null
                      ? "No spending cap"
                      : `Cap ${usd(spend.limitCents / 100)}`)
                  }
                />
                <Metric
                  label="Requests"
                  value={num(requests)}
                  hint={
                    u.quotaLimit
                      ? `Quota ${num(u.quotaLimit)}`
                      : u.billsUsage
                        ? "Every request billed"
                        : undefined
                  }
                />
                <Metric label="Credit" value={usd(u.creditBalance)} />
                <Metric label="Plan" value={planName(u)} hint={billing(u)} />
              </Metrics>
              {(spend?.limitCents || u.quotaLimit > 0) && (
                <div className="mt-8 grid gap-8 @lg:grid-cols-2">
                  {spend?.limitCents ? (
                    <MeterRow
                      label="Spending cap"
                      value={`${usd(spend.currentSpendCents / 100)} of ${usd(spend.limitCents / 100)}`}
                      meter={
                        <Meter
                          value={spend.currentSpendCents}
                          max={spend.limitCents}
                          label="Spend against the cap"
                        />
                      }
                    />
                  ) : null}
                  {u.quotaLimit > 0 && (
                    <MeterRow
                      label="Monthly quota"
                      value={`${num(requests)} of ${num(u.quotaLimit)}`}
                      meter={
                        <Meter
                          value={requests}
                          max={u.quotaLimit}
                          label="Requests against the quota"
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
