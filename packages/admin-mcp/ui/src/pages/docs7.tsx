import { IconExternalLink, IconSearch, IconSelector } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { DailyBars, RankedList, SERIES } from "../charts";
import {
  Button,
  Card,
  ChatButton,
  Chips,
  Empty,
  ErrorNote,
  Loaded,
  Metric,
  Metrics,
  MetricsSkeleton,
  RowsSkeleton,
  Segmented,
  Skeleton,
  StateLabel,
} from "../components";
import {
  siteName,
  useTool,
  type Crawlers,
  type Deployment,
  type Humans,
  type Queries,
  type Site,
} from "../data";
import { ago, num, pct } from "../format";
import { host } from "../host";

/** docs7_list_sites: one page of sites (50), and how many match in all. */
type Sites = { total: number; sites: Site[]; cliSites: Site[] };

/** Up to this many sites the page shows them all as chips; above it, a search list. */
const CHIP_LIMIT = 6;

/** The site's reports for a window, read in parallel. */
function useSiteReports(teamspace: string, site: Site | undefined, days: number) {
  const args = site ? { teamspace, site_id: site.id, days } : {};
  const tool = site ? "docs7_get_analytics" : undefined;
  return {
    humans: useTool<{ data: Humans }>(tool, { ...args, report: "visitors" }),
    crawlers: useTool<{ data: Crawlers }>(tool, { ...args, report: "ai_crawlers" }),
    queries: useTool<{ data: Queries }>(tool, { ...args, report: "queries" }),
  };
}

const allSites = (data: Sites) => [...data.sites, ...data.cliSites];

export function Docs7Summary({ teamspace }: { teamspace: string }) {
  const sites = useTool<Sites>("docs7_list_sites", { teamspace });
  const site = sites.data ? allSites(sites.data)[0] : undefined;
  const { humans, crawlers, queries } = useSiteReports(teamspace, site, 7);
  if (sites.data && !site) return <Empty>No Docs7 sites in this teamspace.</Empty>;
  // A report that fails (for example analytics not set up) shows "–", not an endless skeleton.
  const value = <T,>(result: { data?: T; error?: string }, read: (data: T) => string) =>
    result.data ? read(result.data) : result.error ? "–" : <Skeleton className="h-6 w-14" />;
  return (
    <Loaded result={sites} skeleton={<MetricsSkeleton chart={false} />}>
      {() => (
        <div className="grid gap-3">
          <p className="truncate text-sm text-fg-2">
            {siteName(site!)} · last 7 days
            {sites.data && sites.data.total > 1 && ` · 1 of ${num(sites.data.total)} sites`}
          </p>
          <Metrics>
            <Metric
              label="Visitors"
              value={value(humans, ({ data }) => num(data.totals.visitors))}
            />
            <Metric
              label="Page views"
              value={value(humans, ({ data }) => num(data.totals.pageViews))}
            />
            <Metric
              label="AI requests"
              value={value(crawlers, ({ data }) => num(data.totals.totalRequests))}
            />
            <Metric
              label="No result"
              value={value(queries, ({ data }) =>
                pct(data.totals.noResultSearches, data.totals.searches)
              )}
              hint="of searches"
            />
          </Metrics>
        </div>
      )}
    </Loaded>
  );
}

export function Docs7Page({ teamspace, name }: { teamspace: string; name: string }) {
  const sites = useTool<Sites>("docs7_list_sites", { teamspace });
  const [picked, setPicked] = useState<Site>();
  const [days, setDays] = useState(7);
  const site = picked ?? (sites.data ? allSites(sites.data)[0] : undefined);
  const { humans, crawlers, queries } = useSiteReports(teamspace, site, days);
  const builds = useTool<{ data: Deployment[] | { deployments: Deployment[] } }>(
    site ? "docs7_list_deployments" : undefined,
    { teamspace, site_id: site?.id }
  );
  useEffect(() => {
    if (site)
      host.setModelContext(
        `The user is looking at Docs7 site ${siteName(site)} (site_id ${site.id}) of teamspace "${name}" (${teamspace}), last ${days} days, in the Context7 console.`
      );
  }, [teamspace, name, site, days]);

  if (sites.error) return <ErrorNote message={sites.error} onRetry={sites.reload} />;
  if (!sites.data)
    return (
      <Card>
        <MetricsSkeleton />
      </Card>
    );
  if (!site)
    return (
      <Card>
        <Empty>No Docs7 sites in this teamspace. Add one with docs7_create_site.</Empty>
      </Card>
    );

  return (
    <div className="grid gap-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <SitePicker teamspace={teamspace} first={sites.data} site={site} onPick={setPicked} />
        <div className="flex items-center gap-2">
          {site.url && (
            <Button
              variant="ghost"
              onClick={() =>
                host.openLink(site.customDomain ? `https://${site.customDomain}` : site.url!)
              }
            >
              <IconExternalLink aria-hidden />
              Open site
            </Button>
          )}
          <Segmented
            label="Window"
            value={days}
            onChange={setDays}
            options={[7, 30, 90].map((d) => ({ value: d, label: `${d} days` }))}
          />
        </div>
      </div>

      <Card title="Readers">
        <Loaded result={humans} skeleton={<MetricsSkeleton />}>
          {({ data: h }) => (
            <div className="grid gap-8">
              {h.days < days && (
                <p className="text-xs text-fg-3">The plan keeps {h.days} days of history.</p>
              )}
              <Metrics>
                <Metric label="Visitors" value={num(h.totals.visitors)} />
                <Metric label="Page views" value={num(h.totals.pageViews)} />
                <Metric
                  label="Top page"
                  value={<span className="text-base">{h.topPages[0]?.path ?? "–"}</span>}
                />
                <Metric
                  label="Top referrer"
                  value={<span className="text-base">{h.topReferrers[0]?.referrer ?? "–"}</span>}
                />
              </Metrics>
              <DailyBars
                format={num}
                series={[{ name: "Page views", color: SERIES[0]! }]}
                points={h.dailySeries.map((d) => ({ date: d.date, values: [d.pageViews] }))}
              />
              <div className="grid gap-8 @2xl:grid-cols-3">
                <Ranked
                  title="Pages"
                  rows={h.topPages.map((p) => ({ key: p.path, label: p.path, value: p.pageViews }))}
                />
                <Ranked
                  title="Referrers"
                  rows={h.topReferrers.map((r) => ({
                    key: r.referrer,
                    label: r.referrer,
                    value: r.visitors,
                  }))}
                />
                <Ranked
                  title="Countries"
                  rows={h.topCountries.map((c) => ({
                    key: c.country,
                    label: c.country,
                    value: c.visitors,
                  }))}
                />
              </div>
            </div>
          )}
        </Loaded>
      </Card>

      <div className="grid gap-8 @3xl:grid-cols-2">
        <Card title="AI crawlers">
          <Loaded result={crawlers} skeleton={<RowsSkeleton />}>
            {({ data: c }) => (
              <div className="grid gap-4">
                <p className="text-xs text-fg-3">
                  {num(c.totals.totalRequests)} requests from {c.totals.uniqueBots} bots,{" "}
                  {pct(c.totals.verifiedRequests, c.totals.totalRequests)} verified
                </p>
                <RankedList
                  rows={c.byCompany
                    .slice(0, 6)
                    .map((r) => ({ key: r.company, label: r.company, value: r.requests }))}
                />
              </div>
            )}
          </Loaded>
        </Card>
        <Card
          title="Reader searches"
          action={
            <ChatButton
              prompt={`Find the doc gaps of Docs7 site ${siteName(site)} (site_id ${site.id}) from its searches with no result, and fix them in the repository.`}
            >
              Fix gaps
            </ChatButton>
          }
        >
          <Loaded result={queries} skeleton={<RowsSkeleton />}>
            {({ data: q }) => (
              <div className="grid gap-4">
                <p className="text-xs text-fg-3">
                  {num(q.totals.searches)} searches,{" "}
                  {pct(q.totals.noResultSearches, q.totals.searches)} with no result,{" "}
                  {num(q.totals.questions)} assistant questions
                </p>
                <RankedList
                  rows={q.topSearches.map((s) => ({
                    key: s.query,
                    label: s.query,
                    value: s.searches,
                    note: s.noResults > 0 ? `${num(s.noResults)} no result` : undefined,
                  }))}
                  empty="No searches in this window."
                />
              </div>
            )}
          </Loaded>
        </Card>
      </div>

      <Card title="Builds">
        <Loaded result={builds} skeleton={<RowsSkeleton />}>
          {({ data }) => {
            const rows = (Array.isArray(data) ? data : data.deployments).slice(0, 8);
            if (rows.length === 0) return <Empty>No builds yet.</Empty>;
            return (
              <ul className="-my-2 grid">
                {rows.map((d) => (
                  // The message gets its own line, so a phone-width row does not squeeze it.
                  <li
                    key={d.id}
                    className="grid gap-2 border-t border-line py-4 first:border-0 first:pt-0"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">
                        {d.commitMessage ?? d.id}
                      </span>
                      {d.failure && (
                        <span className="mt-0.5 block truncate text-xs text-bad">
                          {d.failure.message}
                        </span>
                      )}
                    </span>
                    <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
                      <StateLabel state={d.state} />
                      <span className="min-w-0 truncate text-xs text-fg-3">
                        {d.target === "preview" ? d.branch : "Production"} · {ago(d.createdAt)}
                      </span>
                      {d.state === "failed" && (
                        <span className="ml-auto">
                          <ChatButton
                            prompt={`The Docs7 build ${d.id} of site ${siteName(site)} (site_id ${site.id}) failed. Read it with docs7_get_deployment including health and logs, then fix the repository.`}
                          >
                            Fix
                          </ChatButton>
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            );
          }}
        </Loaded>
      </Card>
    </div>
  );
}

function Ranked({
  title,
  rows,
}: {
  title: string;
  rows: Parameters<typeof RankedList>[0]["rows"];
}) {
  return (
    <div className="min-w-0">
      <h3 className="mb-1 text-xs font-medium text-fg-3">{title}</h3>
      <RankedList rows={rows} />
    </div>
  );
}

/**
 * The site in view. A few sites are chips; many (a teamspace can hold hundreds) are a search list
 * that asks docs7_list_sites for matches, 50 at a time.
 */
function SitePicker({
  teamspace,
  first,
  site,
  onPick,
}: {
  teamspace: string;
  first: Sites;
  site: Site;
  onPick: (site: Site) => void;
}) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [search, setSearch] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setSearch(typed.trim()), 300);
    return () => clearTimeout(timer);
  }, [typed]);
  const found = useTool<Sites>(open && search ? "docs7_list_sites" : undefined, {
    teamspace,
    search,
  });

  if (first.total <= 1)
    return <h2 className="truncate text-base font-semibold">{siteName(site)}</h2>;
  if (first.total <= CHIP_LIMIT)
    return (
      <Chips
        label="Site"
        value={site.id}
        onChange={(id) => onPick(allSites(first).find((s) => s.id === id)!)}
        options={allSites(first).map((s) => ({ value: s.id, label: siteName(s) }))}
      />
    );

  const results = search ? found.data : first;
  return (
    <div className="grid w-full gap-2">
      <div className="flex min-w-0 items-center gap-2">
        <h2 className="min-w-0 truncate text-base font-semibold">{siteName(site)}</h2>
        <Button variant="ghost" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          <IconSelector aria-hidden />
          {num(first.total)} sites
        </Button>
      </div>
      {open && (
        <div className="grid border gap-2 rounded-lg border-line bg-bg p-2">
          <label className="flex border h-8 items-center gap-2 rounded-md border-line px-2.5 coarse:h-11">
            <IconSearch className="size-4 shrink-0 text-fg-3" aria-hidden />
            <input
              autoFocus
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              placeholder="Search by name, repository or address"
              aria-label="Search sites"
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-fg-3"
            />
          </label>
          {found.error ? (
            <p className="px-1 text-xs text-bad">{found.error.split("\n")[0]}</p>
          ) : !results ? (
            <RowsSkeleton rows={3} />
          ) : (
            <>
              <ul className="grid max-h-72 overflow-y-auto">
                {allSites(results).map((s) => (
                  <li key={s.id}>
                    <button
                      onClick={() => {
                        onPick(s);
                        setOpen(false);
                      }}
                      aria-current={s.id === site.id}
                      className="flex w-full flex-col items-start rounded-md px-2 py-1.5 text-left hover:bg-surface aria-[current=true]:bg-surface coarse:py-2.5"
                    >
                      <span className="w-full truncate text-sm font-medium">{siteName(s)}</span>
                      {s.repoUrl && (
                        <span className="w-full truncate text-xs text-fg-3">
                          {s.repoUrl.replace(/^https:\/\/github\.com\//, "")}
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
              <p className="px-1 text-xs text-fg-3">
                {results.total === 0
                  ? "No site matches."
                  : results.total > allSites(results).length
                    ? `Showing ${allSites(results).length} of ${num(results.total)}. Type to narrow the list.`
                    : `${num(results.total)} ${results.total === 1 ? "site" : "sites"}`}
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
