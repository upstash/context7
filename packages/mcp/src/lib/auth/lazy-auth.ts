import { getRedis } from "../redis.js";
import { isJWT, validateJWT } from "../jwt.js";

/**
 * Lazy ("mixed") authentication for the public `/mcp` endpoint.
 *
 * Anonymous clients can connect, run `initialize`, list tools, and call public
 * tools. The server only challenges when an unauthenticated caller crosses one
 * of two lines:
 *   1. it calls a tool listed in {@link PROTECTED_TOOLS}, or
 *   2. it exhausts the anonymous free-call allowance ({@link ANON_FREE_CALLS}).
 *
 * The decision MUST be made at the HTTP layer before the JSON-RPC handler runs:
 * the StreamableHTTP transport streams a 200 and flushes headers as soon as it
 * starts handling a request, so a tool-level error can no longer become a 401
 * and the client never sees the auth challenge. See {@link evaluateLazyAuth}.
 *
 * The challenge is delivered in one of two shapes, because the two client
 * families disagree on what an auth challenge looks like — see
 * {@link challengeTransportFor}:
 *
 *   - `http-401` (default): HTTP 401 + `WWW-Authenticate`, per the MCP
 *     authorization spec. Claude, VS Code, Cursor, Cline, Zed and every other
 *     spec-compliant client pause the call, run OAuth, and retry.
 *   - `tool-result`: HTTP 200 wrapping a `CallToolResult` with `isError: true`
 *     and the challenge under `_meta["mcp/www_authenticate"]`. This is what
 *     ChatGPT and Codex read; a bare 401 does not raise their link-account UI.
 *
 * Both shapes carry the same RFC 6750 challenge string, so a client that
 * understands either one gets the same discovery chain.
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

/** Scopes advertised per tool in `tools/list`; mirrors {@link CHALLENGE_SCOPE}. */
const TOOL_SCOPES = CHALLENGE_SCOPE.split(" ");

/**
 * Per-tool authentication requirements advertised on the `tools/list` wire
 * format. OpenAI clients read this to decide whether a tool can run before the
 * user has linked an account: `noauth` alone runs immediately, `oauth2` alone
 * forces linking first, and both together mean "runs anonymously, links when
 * the server asks" — which is exactly the lazy-auth contract.
 *
 * Clients that don't know the field ignore it, so it is safe to send to
 * everyone.
 */
export type SecurityScheme = { type: "noauth" } | { type: "oauth2"; scopes: string[] };

/**
 * Security schemes for `toolName`: protected tools require OAuth up front,
 * every other tool advertises mixed auth.
 */
export function securitySchemesFor(toolName: string): SecurityScheme[] {
  if (PROTECTED_TOOLS.has(toolName)) {
    return [{ type: "oauth2", scopes: TOOL_SCOPES }];
  }
  return [{ type: "noauth" }, { type: "oauth2", scopes: TOOL_SCOPES }];
}

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

/** How the challenge must be delivered for the calling client to act on it. */
export type ChallengeTransport = "http-401" | "tool-result";

/**
 * User-Agent fragments identifying clients that surface an auth prompt from a
 * `CallToolResult` rather than from an HTTP 401. Override with a
 * comma-separated `CONTEXT7_TOOL_RESULT_CHALLENGE_CLIENTS` if a client changes
 * its UA or a new one needs the same treatment.
 */
const TOOL_RESULT_CHALLENGE_CLIENTS = (
  process.env.CONTEXT7_TOOL_RESULT_CHALLENGE_CLIENTS ?? "openai-mcp,chatgpt,codex"
)
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

/**
 * Pick the challenge shape for a caller. Defaults to the spec-compliant HTTP
 * 401 and only opts a client into the `_meta` form when its User-Agent says it
 * needs it — an unrecognised client is far better served by the standard.
 */
export function challengeTransportFor(userAgent: string | undefined): ChallengeTransport {
  if (!userAgent) return "http-401";
  const ua = userAgent.toLowerCase();
  return TOOL_RESULT_CHALLENGE_CLIENTS.some((marker) => ua.includes(marker))
    ? "tool-result"
    : "http-401";
}

/**
 * JSON-RPC body for a `tool-result` challenge: a successful HTTP response
 * carrying a failed tool call, with the RFC 6750 challenge in
 * `_meta["mcp/www_authenticate"]`. `error_description` is required here — the
 * OpenAI clients use its presence to decide the failure is an auth problem
 * rather than a tool bug.
 */
export function buildToolResultChallenge(challenge: Challenge, baseUrl: string) {
  return {
    jsonrpc: "2.0" as const,
    id: challenge.id ?? null,
    result: {
      isError: true,
      content: [{ type: "text" as const, text: challenge.message }],
      _meta: {
        "mcp/www_authenticate": [buildWwwAuthenticate(baseUrl, challenge.error, challenge.message)],
      },
    },
  };
}

/** JSON-RPC body for an `http-401` challenge, sent with `challenge.status`. */
export function buildHttpChallenge(challenge: Challenge) {
  return {
    jsonrpc: "2.0" as const,
    error: { code: -32001, message: challenge.message },
    id: challenge.id ?? null,
  };
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

/** Strip the quoting characters RFC 6750 does not allow inside a quoted value. */
function sanitizeAuthParam(value: string): string {
  return value.replace(/[\\"]/g, "").replace(/\s+/g, " ").trim();
}

/**
 * Build the RFC 6750 `WWW-Authenticate` value, pointing clients at the Protected
 * Resource Metadata document for OAuth discovery. Pass an `error` on a challenge
 * response; omit it on ordinary responses where the header is purely advisory.
 *
 * `scope` tells the client which scopes to request, so it doesn't fall back to
 * asking for everything in `scopes_supported`.
 */
export function buildWwwAuthenticate(
  baseUrl: string,
  error?: Challenge["error"],
  description?: string
): string {
  const parts = [
    error ? `error="${error}"` : null,
    error && description ? `error_description="${sanitizeAuthParam(description)}"` : null,
    `resource_metadata="${baseUrl}/.well-known/oauth-protected-resource"`,
    `scope="${CHALLENGE_SCOPE}"`,
  ].filter(Boolean);
  return `Bearer ${parts.join(", ")}`;
}
