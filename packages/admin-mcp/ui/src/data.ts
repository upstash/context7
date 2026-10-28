import { useCallback, useEffect, useState } from "react";
import { host } from "./host";

/*
 * Reads through this server's read tools (the same ones the model calls), in
 * the shapes they answer: src/tools.ts over the management API in context7app.
 * Answers are kept for the page's life, so going back to a page is instant;
 * `reload` asks again.
 */

const cache = new Map<string, unknown>();

type ToolState<T> = { data?: T; error?: string; loading: boolean; reload: () => void };

export function useTool<T>(name: string | undefined, args: object = {}): ToolState<T> {
  const key = name ? JSON.stringify([name, args]) : "";
  const [state, setState] = useState<{ key: string; data?: T; error?: string }>(() => ({
    key,
    data: cache.get(key) as T | undefined,
  }));
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    if (!name) return;
    if (nonce === 0 && cache.has(key)) {
      setState({ key, data: cache.get(key) as T });
      return;
    }
    let live = true;
    setState((s) => ({ key, data: s.key === key ? s.data : undefined }));
    host
      .callTool<T>(name, args)
      .then((data) => {
        cache.set(key, data);
        if (live) setState({ key, data });
      })
      .catch((error: Error) => live && setState({ key, error: error.message }));
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
  quotaLimit: number;
  ownerPlan: string;
  billingModel: "seat" | "payg";
  billsUsage: boolean;
  creditBalance: number;
};

export type TeamspaceDetails = {
  teamspace: { name: string; role: string; ownerPlan: string | null; docs7ProEnabled: boolean };
  spendingLimit: { limitCents: number | null; currentSpendCents: number; canEdit: boolean };
};

export type Library = {
  id: string;
  title?: string;
  description?: string;
  private: boolean;
  owned: boolean;
  state: "processing" | "finalizing" | "complete" | "error";
  totalSnippets?: number;
  totalTokens?: number;
  benchmarkScore?: number;
  lastUpdateDate?: string;
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
