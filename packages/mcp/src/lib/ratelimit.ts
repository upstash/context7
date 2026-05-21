import { Ratelimit } from "@upstash/ratelimit";
import { getRedis } from "./redis.js";

type Duration = Parameters<typeof Ratelimit.slidingWindow>[1];

const DEFAULTS = {
  sessionCreate: { tokens: 60, window: "1 m" as Duration },
};

function parseTokens(envVar: string | undefined, fallback: number): number {
  if (!envVar) return fallback;
  const parsed = Number.parseInt(envVar, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseWindow(envVar: string | undefined, fallback: Duration): Duration {
  return envVar ? (envVar as Duration) : fallback;
}

export function createRateLimiters() {
  const redis = getRedis();

  const sessionCreateTokens = parseTokens(
    process.env.MCP_SESSION_CREATE_LIMIT,
    DEFAULTS.sessionCreate.tokens
  );
  const sessionCreateWindow = parseWindow(
    process.env.MCP_SESSION_CREATE_WINDOW,
    DEFAULTS.sessionCreate.window
  );

  return {
    // Per-IP limit on session creation. Sessions are unauthenticated and live
    // 7 days in Redis, so an attacker could otherwise spam init requests to bloat
    // Redis cardinality. Refresh and delete don't grow cardinality, so they are
    // not rate-limited here.
    sessionCreate: new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(sessionCreateTokens, sessionCreateWindow),
      prefix: "mcp:ratelimit:session-create",
      analytics: false,
    }),
  };
}
