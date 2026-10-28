import { useEffect, useState } from "react";
import { DailyBars, RankedList, SERIES } from "../charts";
import {
  Card,
  ChatButton,
  Chips,
  Empty,
  Loaded,
  Metric,
  Metrics,
  MetricsSkeleton,
  Segmented,
  StateLabel,
} from "../components";
import { useTool, type AskAnalytics, type AskSite } from "../data";
import { num, pct } from "../format";
import { host } from "../host";

type Days = 1 | 7 | 30;

/** Ask's client keys (AskClient in context7app) as their makers write them. */
const CLIENT_NAMES: Record<string, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  perplexity: "Perplexity",
  cursor: "Cursor",
  opencode: "OpenCode",
  meta: "Meta",
  mistral: "Mistral",
  xai: "xAI",
  browser: "Browser",
  unknown: "Unknown",
};
const clientName = (key?: string) => (key ? (CLIENT_NAMES[key] ?? key) : "–");

const totals = (a: AskAnalytics) => {
  const total = a.series.reduce((n, p) => n + p.total, 0);
  const unanswered = a.series.reduce((n, p) => n + p.unanswered, 0);
  return { total, unanswered };
};

export function AskSummary({ teamspace }: { teamspace: string }) {
  const sites = useTool<{ data: AskSite[] }>("ask_list_sites", { teamspace });
  const site = sites.data?.data[0];
  const analytics = useTool<{ data: AskAnalytics }>(site ? "ask_get_analytics" : undefined, {
    teamspace,
    site_key: site?.siteKey,
    days: 30,
  });
  if (sites.data && !site) return <Empty>No Ask sites in this teamspace.</Empty>;
  return (
    <Loaded result={analytics} skeleton={<MetricsSkeleton chart={false} />}>
      {({ data: a }) => {
        const { total, unanswered } = totals(a);
        return (
          <div className="grid gap-3">
            <p className="truncate text-sm text-fg-2">
              {site!.hostname} · last 30 days
              {sites.data!.data.length > 1 && ` · 1 of ${sites.data!.data.length} sites`}
            </p>
            <Metrics>
              <Metric label="Questions" value={num(total)} />
              <Metric
                label="Unanswered"
                value={pct(unanswered, total)}
                tone={unanswered / Math.max(1, total) > 0.2 ? "bad" : undefined}
              />
              <Metric label="Top client" value={clientName(a.clients[0]?.client)} />
              <Metric label="Gaps" value={num(a.gaps.length)} hint="unanswered questions" />
            </Metrics>
          </div>
        );
      }}
    </Loaded>
  );
}

export function AskPage({ teamspace, name }: { teamspace: string; name: string }) {
  const sites = useTool<{ data: AskSite[] }>("ask_list_sites", { teamspace });
  const [siteKey, setSiteKey] = useState<string>();
  const [days, setDays] = useState<Days>(30);
  const all = sites.data?.data ?? [];
  const site = all.find((s) => s.siteKey === siteKey) ?? all[0];
  const analytics = useTool<{ data: AskAnalytics }>(site ? "ask_get_analytics" : undefined, {
    teamspace,
    site_key: site?.siteKey,
    days,
  });
  useEffect(() => {
    if (site)
      host.setModelContext(
        `The user is looking at Ask site ${site.hostname} (site_key ${site.siteKey}) of teamspace "${name}" (${teamspace}), last ${days === 1 ? "24 hours" : `${days} days`}, in the Context7 console.`
      );
  }, [teamspace, name, site, days]);

  if (sites.error || !sites.data)
    return (
      <Loaded
        result={sites}
        skeleton={
          <Card>
            <MetricsSkeleton />
          </Card>
        }
      >
        {() => null}
      </Loaded>
    );
  if (!site)
    return (
      <Card>
        <Empty>No Ask sites in this teamspace. Add one with ask_create_site.</Empty>
      </Card>
    );

  return (
    <div className="grid gap-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        {all.length > 1 ? (
          <Chips
            label="Ask site"
            value={site.siteKey}
            onChange={setSiteKey}
            options={all.map((s) => ({ value: s.siteKey, label: s.hostname }))}
          />
        ) : (
          <h2 className="flex items-center gap-3 truncate text-base font-semibold">
            {site.hostname}
            <StateLabel state={site.indexStatus.kind} />
          </h2>
        )}
        <Segmented
          label="Window"
          value={days}
          onChange={setDays}
          options={[
            { value: 1, label: "24 hours" },
            { value: 7, label: "7 days" },
            { value: 30, label: "30 days" },
          ]}
        />
      </div>
      <Loaded
        result={analytics}
        skeleton={
          <Card>
            <MetricsSkeleton />
          </Card>
        }
      >
        {({ data: a }) => {
          const { total, unanswered } = totals(a);
          return (
            <>
              <Card title="Questions">
                <div className="grid gap-8">
                  <Metrics>
                    <Metric label="Questions" value={num(total)} />
                    <Metric
                      label="Unanswered"
                      value={num(unanswered)}
                      hint={pct(unanswered, total)}
                    />
                    <Metric label="Top client" value={clientName(a.clients[0]?.client)} />
                    <Metric label="Clients" value={num(a.clients.length)} />
                  </Metrics>
                  <DailyBars
                    format={num}
                    series={[
                      { name: "Answered", color: SERIES[0]! },
                      { name: "Unanswered", color: "var(--c7-score-bad)" },
                    ]}
                    points={a.series.map((p) => ({
                      date: p.date,
                      values: [p.total - p.unanswered, p.unanswered],
                    }))}
                  />
                </div>
              </Card>
              <div className="grid gap-8 @3xl:grid-cols-2">
                <Card
                  title="Gaps"
                  action={
                    a.gaps.length > 0 && (
                      <ChatButton
                        prompt={`Add answers to the docs for the unanswered questions of Ask site ${site.hostname} (site_key ${site.siteKey}). Use ask_get_analytics.`}
                      >
                        Fill gaps
                      </ChatButton>
                    )
                  }
                >
                  <RankedList
                    rows={a.gaps
                      .slice(0, 8)
                      .map((g, i) => ({ key: `${i}`, label: g.question, value: g.count }))}
                    empty="Every question got an answer."
                  />
                </Card>
                <Card title="Top questions">
                  <RankedList
                    rows={a.topQuestions
                      .slice(0, 8)
                      .map((q, i) => ({ key: `${i}`, label: q.question, value: q.count }))}
                  />
                </Card>
              </div>
              <Card title="Clients">
                <RankedList
                  rows={a.clients.map((c) => ({
                    key: c.client,
                    label: clientName(c.client),
                    value: c.count,
                  }))}
                />
              </Card>
            </>
          );
        }}
      </Loaded>
    </div>
  );
}
