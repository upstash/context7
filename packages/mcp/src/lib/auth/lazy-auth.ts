import { isQuotaExhausted } from "./quota-state.js";

/**
 * Lazy ("mixed") authentication for the public `/mcp` endpoint.
 *
 * Anonymous clients can connect, run `initialize`, list tools, and call public
 * tools. The server only challenges when an unauthenticated caller crosses one
 * of two lines:
 *   1. it calls a tool listed in {@link PROTECTED_TOOLS}, or
 *   2. the backend reports its free monthly requests spent (see
 *      `quota-state.ts`, which owns that verdict).
 *
 * The decision MUST be made at the HTTP layer before the JSON-RPC message
 * reaches the MCP handler: with `responseMode: "sse"` the handler flushes a 200
 * as soon as it parses the request, so a tool-level error can no longer become
 * a 401 and the client never sees the auth challenge.
 *
 * The challenge is delivered in one of two shapes, because the two client
 * families disagree on what one looks like — see {@link challengeTransportFor}:
 *
 *   - `http-401` (default): HTTP 401 + `WWW-Authenticate`, per the MCP
 *     authorization spec. Claude, VS Code, Cursor, Cline, Zed and every other
 *     spec-compliant client pause the call, run OAuth, and retry.
 *   - `tool-result`: HTTP 200 wrapping a `CallToolResult` with `isError: true`
 *     and the challenge under `_meta["mcp/www_authenticate"]`. This is what
 *     ChatGPT reads; a bare 401 does not raise its link-account UI.
 *
 * Both carry the same RFC 6750 challenge string, so a client that understands
 * either one gets the same discovery chain.
 */

function csvEnv(name: string, fallback = ""): string[] {
  return (process.env[name] ?? fallback)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Tools that always require authentication. `tools/list` still advertises them
 * to anonymous clients — the challenge fires only on `tools/call`. Set the
 * comma-separated `CONTEXT7_PROTECTED_TOOLS` to gate a tool by name.
 *
 * Caveat: this server cannot validate an opaque Context7 key locally (only the
 * backend can), so {@link resolveAuthState} accepts any non-JWT credential.
 * Gating a tool here is therefore only meaningful where callers authenticate
 * with JWTs, which the server does verify.
 */
export const PROTECTED_TOOLS = new Set<string>(csvEnv("CONTEXT7_PROTECTED_TOOLS"));

/** Scope advertised in the challenge; mirrors the PRM document's `scopes_supported`. */
export const AUTH_SCOPES = ["profile", "email"] as const;
const CHALLENGE_SCOPE = AUTH_SCOPES.join(" ");

/**
 * Per-tool authentication requirements, advertised on the tool descriptor.
 * OpenAI clients read this to decide whether a tool can run before the user has
 * linked an account: `noauth` alone runs immediately, `oauth2` alone forces
 * linking first, and both together mean "runs anonymously, links when the
 * server asks" — the lazy-auth contract.
 *
 * The Apps SDK documents this as a top-level field on the tool descriptor, but
 * `securitySchemes` is not part of the MCP schema (SEP-1488 is still draft) and
 * `registerTool` has no such option, so it is carried in the tool's `_meta`,
 * which the SDK does forward. It is advisory either way: the runtime
 * `_meta["mcp/www_authenticate"]` challenge is what actually raises the
 * link-account UI.
 */
export type SecurityScheme = { type: "noauth" } | { type: "oauth2"; scopes: string[] };

export function securitySchemesFor(toolName: string): SecurityScheme[] {
  const oauth2: SecurityScheme = { type: "oauth2", scopes: [...AUTH_SCOPES] };
  return PROTECTED_TOOLS.has(toolName) ? [oauth2] : [{ type: "noauth" }, oauth2];
}

/** `_meta` block for a tool descriptor, ready to pass to `registerTool`. */
export function toolAuthMeta(toolName: string): Record<string, unknown> {
  return { securitySchemes: securitySchemesFor(toolName) };
}

export interface AuthState {
  /** A credential was presented and accepted (opaque key present, or JWT valid). */
  authenticated: boolean;
  /** Why a JWT was rejected, for the eager endpoint's error message. */
  error?: string;
}

/**
 * Resolve whether the caller is authenticated. Opaque Context7 keys are taken
 * at face value — the backend is the authority on their validity — while JWTs
 * are cryptographically verified here. Both `/mcp` and `/mcp/oauth` decide
 * through this function so the two endpoints cannot drift on what counts as
 * signed in.
 */
export async function resolveAuthState(
  apiKey: string | undefined,
  verifyJwt: (token: string) => Promise<{ valid: boolean; error?: string }>,
  isJwt: (token: string) => boolean
): Promise<AuthState> {
  if (!apiKey) return { authenticated: false };
  if (!isJwt(apiKey)) return { authenticated: true };
  const result = await verifyJwt(apiKey);
  return { authenticated: result.valid, error: result.error };
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

/**
 * The id of the `tools/call` being refused, so the challenge correlates with the
 * message that triggered it rather than with whatever came first in a batch.
 */
function challengedId(body: unknown): unknown {
  const call = asMessages(body).find((m) => m.method === "tools/call" && m.id !== undefined);
  return call?.id ?? null;
}

/**
 * Per-client key for the quota verdict: the same identity the backend keys its
 * anonymous quota on, since this server forwards it as `mcp-client-ip`.
 *
 * The value ultimately comes from `X-Forwarded-For` when present, so it is only
 * as trustworthy as the ingress in front of this server. That is the same
 * exposure the backend's own IP-keyed quota already has — this gate mirrors that
 * decision rather than adding a new trust boundary — but a deployment that
 * terminates untrusted traffic directly should strip or pin the header at the
 * proxy.
 */
export function quotaFingerprint(opts: {
  clientIp?: string;
  sessionId?: string;
}): string | undefined {
  return opts.clientIp || opts.sessionId || undefined;
}

export interface Challenge {
  /** RFC 6750 error code, echoed in the `WWW-Authenticate` header. */
  error: "invalid_token";
  message: string;
  /** Echoes the refused request's id so clients can correlate the rejection. */
  id: unknown;
}

/** How the challenge must be delivered for the calling client to act on it. */
export type ChallengeTransport = "http-401" | "tool-result";

/**
 * User-Agent product tokens for clients that surface an auth prompt from a
 * `CallToolResult` rather than an HTTP 401. Override with a comma-separated
 * `CONTEXT7_TOOL_RESULT_CHALLENGE_CLIENTS` when a client changes its UA.
 */
const TOOL_RESULT_CHALLENGE_CLIENTS = csvEnv(
  "CONTEXT7_TOOL_RESULT_CHALLENGE_CLIENTS",
  "openai-mcp,chatgpt"
).map((s) => s.toLowerCase());

/**
 * Pick the challenge shape for a caller. Defaults to the spec-compliant HTTP
 * 401: an unrecognised client is far better served by the standard, and the
 * `_meta` form would read to it as an ordinary tool failure.
 *
 * The match is against the User-Agent's product token only (the `name` in
 * `name/version (comment)`), not the whole string, so a client that merely
 * mentions one of these names in a comment is not misrouted.
 */
export function challengeTransportFor(userAgent: string | undefined): ChallengeTransport {
  if (!userAgent) return "http-401";
  const product = userAgent.split("/")[0].trim().toLowerCase();
  return TOOL_RESULT_CHALLENGE_CLIENTS.includes(product) ? "tool-result" : "http-401";
}

/** Strip characters RFC 6750 does not allow inside a quoted parameter value. */
function sanitizeAuthParam(value: string): string {
  return value.replace(/[\\"]/g, "").replace(/\s+/g, " ").trim();
}

/**
 * Build the RFC 6750 `WWW-Authenticate` value, pointing clients at the Protected
 * Resource Metadata document for OAuth discovery. Pass an `error` on a challenge
 * response; omit it where the header is purely advisory.
 *
 * `scope` tells the client which scopes to request, so it does not fall back to
 * asking for everything the PRM advertises.
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

/** JSON-RPC body for an `http-401` challenge. */
export function buildHttpChallenge(challenge: Challenge) {
  return {
    jsonrpc: "2.0" as const,
    error: { code: -32001, message: challenge.message },
    id: challenge.id ?? null,
  };
}

/**
 * JSON-RPC body for a `tool-result` challenge: a successful HTTP response
 * carrying a failed tool call, with the RFC 6750 challenge in
 * `_meta["mcp/www_authenticate"]`. `error_description` is required — the OpenAI
 * clients use its presence to tell an auth failure from a tool bug.
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

const PROTECTED_TOOL_MESSAGE = "This tool requires authentication. Please sign in to continue.";
const QUOTA_MESSAGE =
  "You have used the free monthly Context7 requests for this machine. " +
  "Sign in to continue with a much higher limit.";

/**
 * Decide whether a request to the lazy `/mcp` endpoint is allowed or must be
 * challenged. Only `tools/call` is gated; `initialize`, `tools/list`,
 * notifications and every other method pass through so anonymous clients can
 * connect and discover tools.
 *
 * `resolveAuth` is a thunk so the caller's credential is only verified once a
 * request is actually gateable — most traffic on this endpoint is `initialize`
 * and `tools/list`, and verifying a JWT for those means a discarded round trip
 * to a remote JWKS on the hottest path.
 */
export async function evaluateLazyAuth(opts: {
  body: unknown;
  resolveAuth: () => Promise<AuthState>;
  clientIp?: string;
  sessionId?: string;
}): Promise<Challenge | undefined> {
  const tools = toolCallsIn(opts.body);
  if (tools.length === 0) return undefined;

  const id = challengedId(opts.body);
  const protectedTool = tools.some((name) => PROTECTED_TOOLS.has(name));
  const overQuota = isQuotaExhausted(quotaFingerprint(opts));
  if (!protectedTool && !overQuota) return undefined;

  if ((await opts.resolveAuth()).authenticated) return undefined;

  return {
    error: "invalid_token",
    message: protectedTool ? PROTECTED_TOOL_MESSAGE : QUOTA_MESSAGE,
    id,
  };
}
