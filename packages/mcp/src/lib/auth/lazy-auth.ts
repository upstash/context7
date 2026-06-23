import { getRedis } from "../redis.js";
import { isJWT, validateJWT } from "../jwt.js";

/**
 * Lazy ("mixed") authentication for the public `/mcp` endpoint.
 *
 * Anonymous clients can connect, run `initialize`, list tools, and call public
 * tools. The server only challenges — with an HTTP 401 carrying a
 * `WWW-Authenticate` header — when an unauthenticated caller crosses one of two
 * lines:
 *   1. it calls a tool listed in {@link PROTECTED_TOOLS}, or
 *   2. it exhausts the anonymous free-call allowance ({@link ANON_FREE_CALLS}).
 *
 * The decision MUST be made at the HTTP layer before the JSON-RPC handler runs:
 * the StreamableHTTP transport streams a 200 and flushes headers as soon as it
 * starts handling a request, so a tool-level error can no longer become a 401
 * and the client never sees the auth challenge. See {@link evaluateLazyAuth}.
 */

const PROTECTED_TOOLS_ENV = (process.env.CONTEXT7_PROTECTED_TOOLS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

/**
 * Tools that always require authentication. `tools/list` still advertises them
 * to anonymous clients — the challenge fires only on `tools/call`. Add the tool
 * name here (or via the comma-separated `CONTEXT7_PROTECTED_TOOLS` env var) to
 * gate it.
 */
export const PROTECTED_TOOLS = new Set<string>([
  // e.g. "query-private-docs",
  ...PROTECTED_TOOLS_ENV,
]);

/**
 * Number of anonymous `tools/call` requests allowed per client before the
 * server starts returning a 401 auth challenge. Set `CONTEXT7_ANON_FREE_CALLS=0`
 * to disable the quota gate (protected-tool gating still applies).
 */
export const ANON_FREE_CALLS = (() => {
  const parsed = parseInt(process.env.CONTEXT7_ANON_FREE_CALLS ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 5;
})();

const ANON_QUOTA_TTL_SECONDS = 24 * 60 * 60;
const ANON_QUOTA_PREFIX = "#mcp#anon-quota#";

/** Scope advertised in the challenge; mirrors PRM `scopes_supported`. */
const CHALLENGE_SCOPE = "profile email";

export interface AuthState {
  /** A credential was presented and accepted (opaque key present, or JWT valid). */
  authenticated: boolean;
}

/**
 * Resolve whether the caller is authenticated for gating purposes. Mirrors the
 * `/mcp/oauth` path: opaque Context7 keys are accepted as-is (the backend is the
 * authority on their validity), while JWTs are cryptographically verified here.
 */
export async function resolveAuthState(apiKey: string | undefined): Promise<AuthState> {
  if (!apiKey) return { authenticated: false };
  if (isJWT(apiKey)) {
    const result = await validateJWT(apiKey);
    return { authenticated: result.valid };
  }
  return { authenticated: true };
}

interface JsonRpcMessage {
  method?: string;
  id?: unknown;
  params?: { name?: string };
}

function asMessages(body: unknown): JsonRpcMessage[] {
  if (Array.isArray(body)) return body as JsonRpcMessage[];
  if (body && typeof body === "object") return [body as JsonRpcMessage];
  return [];
}

/** Tool names invoked by `tools/call` in this request (single message or batch). */
export function toolCallsIn(body: unknown): string[] {
  return asMessages(body)
    .filter((m) => m.method === "tools/call")
    .map((m) => m.params?.name)
    .filter((n): n is string => typeof n === "string");
}

/** First JSON-RPC id in the request, echoed back on the challenge response. */
function firstId(body: unknown): unknown {
  const msg = asMessages(body).find((m) => m.id !== undefined);
  return msg?.id ?? null;
}

/** Per-client key for the anonymous quota counter (IP, falling back to session). */
function clientFingerprint(opts: { clientIp?: string; sessionId?: string }): string | undefined {
  return opts.clientIp || opts.sessionId || undefined;
}

/**
 * Increment and test the anonymous quota for this client. Returns true once the
 * caller has spent its free allowance. Fail-open: Redis errors never block a
 * request (a quota miss is preferable to a false challenge).
 */
async function anonymousQuotaExceeded(fingerprint: string): Promise<boolean> {
  if (ANON_FREE_CALLS <= 0) return false;
  try {
    const redis = getRedis();
    const key = `${ANON_QUOTA_PREFIX}${fingerprint}`;
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, ANON_QUOTA_TTL_SECONDS);
    return count > ANON_FREE_CALLS;
  } catch (err) {
    console.error("[LazyAuth] anonymous quota check failed:", err);
    return false;
  }
}

export interface Challenge {
  status: 401 | 403;
  /** RFC 6750 error code echoed in the `WWW-Authenticate` header. */
  error: "invalid_token" | "insufficient_scope";
  message: string;
  /** Echoes the request id so clients can correlate the rejection. */
  id: unknown;
}

export interface LazyAuthDecision {
  challenge?: Challenge;
}

/**
 * Decide whether a request to the lazy `/mcp` endpoint is allowed or must be
 * challenged. Only `tools/call` is gated; `initialize`, `tools/list`,
 * notifications, and every other method pass through so anonymous clients can
 * connect and discover tools. Authenticated callers bypass both gates.
 */
export async function evaluateLazyAuth(opts: {
  body: unknown;
  auth: AuthState;
  clientIp?: string;
  sessionId?: string;
}): Promise<LazyAuthDecision> {
  const tools = toolCallsIn(opts.body);
  if (tools.length === 0) return {};
  if (opts.auth.authenticated) return {};

  if (tools.some((name) => PROTECTED_TOOLS.has(name))) {
    return {
      challenge: {
        status: 401,
        error: "invalid_token",
        message: "This tool requires authentication. Please sign in to continue.",
        id: firstId(opts.body),
      },
    };
  }

  const fingerprint = clientFingerprint(opts);
  if (fingerprint && (await anonymousQuotaExceeded(fingerprint))) {
    return {
      challenge: {
        status: 401,
        error: "invalid_token",
        message: "Anonymous usage limit reached. Please sign in to continue using Context7.",
        id: firstId(opts.body),
      },
    };
  }

  return {};
}

/**
 * Build the RFC 6750 `WWW-Authenticate` value, pointing clients at the Protected
 * Resource Metadata document for OAuth discovery. Pass an `error` on a challenge
 * response; omit it on ordinary responses where the header is purely advisory.
 */
export function buildWwwAuthenticate(baseUrl: string, error?: Challenge["error"]): string {
  const parts = [
    error ? `error="${error}"` : null,
    `resource_metadata="${baseUrl}/.well-known/oauth-protected-resource"`,
    `scope="${CHALLENGE_SCOPE}"`,
  ].filter(Boolean);
  return `Bearer ${parts.join(", ")}`;
}
