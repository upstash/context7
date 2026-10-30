import { useCallback, useEffect, useState } from "react";
import type { ConsoleRead } from "../../src/tools";
import { host } from "./host";

/*
 * Reads through `console_data`, which runs one of the server's read tools for
 * the page and answers in their shapes: src/tools.ts over the management API
 * in context7app.
 * A page shows the answer it had at once and asks again in the background, so
 * going back to a page is instant and still picks up a finished build or a
 * change made in the chat. `reload` asks again after an error.
 */

const cache = new Map<string, unknown>();

type ToolState<T> = { data?: T; error?: string; loading: boolean; reload: () => void };

export function useTool<T>(name: ConsoleRead | undefined, args: object = {}): ToolState<T> {
  const key = name ? JSON.stringify([name, args]) : "";
  const [state, setState] = useState<{ key: string; data?: T; error?: string }>(() => ({
    key,
    data: cache.get(key) as T | undefined,
  }));
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    if (!name) return;
    let live = true;
    setState((s) => ({ key, data: s.key === key ? s.data : (cache.get(key) as T | undefined) }));
    host
      .read<T>(name, args)
      .then((data) => {
        cache.set(key, data);
        if (live) setState({ key, data });
      })
      // A failed refresh keeps the answer on screen; with none, the error shows with Retry.
      .catch(
        (error: Error) =>
          live && setState((s) => (s.key === key && s.data ? s : { key, error: error.message }))
      );
    return () => {
      live = false;
    };
    // `key` covers name and args.
  }, [key, nonce]);
  const reload = useCallback(() => setNonce((n) => n + 1), []);
  const current = state.key === key;
  return {
    data: current ? state.data : undefined,
    error: current ? state.error : undefined,
    loading: Boolean(name) && (!current || (!state.data && !state.error)),
    reload,
  };
}

/* ------------------------------------------------------------- shapes */

export type Usage = {
  dailyStats: {
    date: string;
    searchRequests: number;
    fetchDocsRequests: number;
    parseTokensCost: number;
    memberCost: number;
    apiUsageCost: number;
  }[];
  /** The calling user's monthly allowance, in requests. */
  quotaLimit: number;
  ownerPlan: string;
  billingModel: "seat" | "payg";
  /** The calling user's requests this UTC month. */
  userRequests?: number;
  /** Requests billed this month on pay as you go. */
  billedRequests?: number;
  creditBalance: number;
};

export type TeamspaceDetails = {
  /** In cents; no `limitCents` when there is no cap. */
  spendingLimit: { limitCents?: number; currentSpendCents: number };
};

export type Library = {
  id: string;
  title?: string;
  private: boolean;
  owned: boolean;
  state: "processing" | "finalizing" | "complete" | "error";
  totalSnippets?: number;
  benchmarkScore?: number;
};

/** list_libraries: one page (50), sorted; the counts cover every match. */
export type LibraryList = {
  total: number;
  page: number;
  pages: number;
  parsing: number;
  failed: number;
  libraries: Library[];
};

export type Benchmarks = {
  stats: {
    count: number;
    averageScore: number | null;
    averageScoreLast10: number | null;
    minScore: number | null;
    maxScore: number | null;
    latestBenchmarkDate: string | null;
  };
  benchmarks: { benchmarkDate: string; score: number; query: string; explanation?: string }[];
};

export type Site = {
  id: string;
  name?: string;
  repoUrl?: string;
  url?: string;
  customDomain?: string;
  /** "active" once the domain serves the site; before that, readers use `url`. */
  customDomainStatus?: string;
};

export type Humans = {
  days: number;
  totals: { visitors: number; pageViews: number };
  dailySeries: { date: string; visitors: number; pageViews: number }[];
  topPages: { path: string; visitors: number; pageViews: number }[];
  topReferrers: { referrer: string; visitors: number }[];
  topCountries: { country: string; visitors: number }[];
};

export type Crawlers = {
  totals: { totalRequests: number; verifiedRequests: number; uniqueBots: number };
  byCompany: { company: string; requests: number }[];
};

export type Queries = {
  totals: { searches: number; noResultSearches: number; questions: number };
  topSearches: { query: string; searches: number; noResults: number }[];
};

export type Deployment = {
  id: string;
  state: "queued" | "building" | "succeeded" | "failed" | "canceled";
  target: "production" | "preview";
  branch: string | null;
  commitMessage: string | null;
  createdAt: string;
  failure?: { kind: string; message: string };
};

export type AskSite = { siteKey: string; hostname: string; indexStatus: { kind: string } };

export type AskAnalytics = {
  series: { date: string; total: number; unanswered: number }[];
  clients: { client: string; count: number }[];
  gaps: { question: string; count: number }[];
  topQuestions: { question: string; count: number }[];
};

/** The name a reader knows a Docs7 site by. */
export const siteName = (site: Site) =>
  site.name ??
  site.customDomain ??
  site.url?.replace(/^https:\/\//, "") ??
  site.repoUrl?.replace(/^https:\/\/github\.com\//, "") ??
  site.id;
