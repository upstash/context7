import { createHash } from "node:crypto";
import { CONTEXT7_API_BASE_URL, SERVER_VERSION } from "./constants.js";
import { observeUpstreamRequest } from "./telemetry-runtime.js";

/**
 * Opaque Clerk OAuth access tokens (`oat_…`) cannot be verified locally the way
 * JWTs can. MCP clients only refresh a token after an HTTP 401, and a tool
 * result is always HTTP 200, so an expired token forwarded to the Context7 API
 * leaves a signed-in client stuck with text errors. The hosted server therefore
 * asks the Context7 API whether the token is still accepted before the request
 * reaches the MCP transport, and answers 401 when it is not.
 */

export type OpaqueOAuthTokenVerdict = "valid" | "invalid" | "unavailable";

export const EXPIRED_OAUTH_TOKEN_ERROR = "The access token expired or is invalid";

/** Response body `error` code the Context7 API uses for a rejected `oat_` bearer. */
export const INVALID_OAUTH_TOKEN_ERROR_CODE = "invalid_oauth_token";

const AUTH_CHECK_PATH = "/v2/auth/check";
const AUTH_CHECK_TIMEOUT_MS = 5_000;
const VALID_TTL_MS = 60_000;
const INVALID_TTL_MS = 30_000;
// A short negative cache keeps an outage from adding the check's latency to
// every request while still retrying soon after the API recovers.
const UNAVAILABLE_TTL_MS = 10_000;
const MAX_CACHE_ENTRIES = 10_000;

interface CachedVerdict {
  verdict: OpaqueOAuthTokenVerdict;
  expiresAt: number;
}

// Keyed by the SHA-256 of the token so a heap dump or a debug print of the
// cache never exposes a usable credential. Map insertion order doubles as the
// eviction order once the cache is full.
const verdicts = new Map<string, CachedVerdict>();
const inFlight = new Map<string, Promise<OpaqueOAuthTokenVerdict>>();

export function isOpaqueOAuthToken(token: string | undefined): token is string {
  return typeof token === "string" && token.startsWith("oat_");
}

/**
 * `MCP_OAUTH_TOKEN_VALIDATION=off` is the rollback switch: opaque OAuth tokens
 * then pass through to the Context7 API exactly as before.
 */
export function isOpaqueOAuthTokenValidationEnabled(
  raw = process.env.MCP_OAUTH_TOKEN_VALIDATION
): boolean {
  const value = raw?.trim().toLowerCase();
  return !(value === "off" || value === "false" || value === "0");
}

function cacheKey(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function ttlFor(verdict: OpaqueOAuthTokenVerdict): number {
  if (verdict === "valid") return VALID_TTL_MS;
  if (verdict === "invalid") return INVALID_TTL_MS;
  return UNAVAILABLE_TTL_MS;
}

function remember(key: string, verdict: OpaqueOAuthTokenVerdict, now: number): void {
  verdicts.delete(key);
  while (verdicts.size >= MAX_CACHE_ENTRIES) {
    const oldest = verdicts.keys().next().value;
    if (oldest === undefined) break;
    verdicts.delete(oldest);
  }
  verdicts.set(key, { verdict, expiresAt: now + ttlFor(verdict) });
}

function recall(key: string, now: number): OpaqueOAuthTokenVerdict | undefined {
  const cached = verdicts.get(key);
  if (!cached) return undefined;
  if (cached.expiresAt <= now) {
    verdicts.delete(key);
    return undefined;
  }
  return cached.verdict;
}

async function readErrorCode(response: Response): Promise<string | undefined> {
  try {
    const body = (await response.json()) as { error?: unknown };
    return typeof body.error === "string" ? body.error : undefined;
  } catch {
    return undefined;
  }
}

async function requestVerdict(token: string): Promise<OpaqueOAuthTokenVerdict> {
  const abortSignal = AbortSignal.timeout(AUTH_CHECK_TIMEOUT_MS);
  try {
    return await observeUpstreamRequest(
      "auth_check",
      () =>
        fetch(`${CONTEXT7_API_BASE_URL}${AUTH_CHECK_PATH}`, {
          headers: {
            Authorization: `Bearer ${token}`,
            "X-Context7-Source": "mcp-server",
            "X-Context7-Server-Version": SERVER_VERSION,
            "X-Context7-Transport": "http",
          },
          signal: abortSignal,
        }),
      async (response) => {
        if (response.ok) return "valid";
        // Only the API's explicit rejection of the OAuth token counts; any other
        // status (404 before the endpoint ships, 429, 5xx) fails open.
        if (response.status === 401) {
          const code = await readErrorCode(response);
          if (code === INVALID_OAUTH_TOKEN_ERROR_CODE) return "invalid";
        }
        console.error(`[Context7] OAuth token check unavailable (status ${response.status})`);
        return "unavailable";
      },
      { abortSignal }
    );
  } catch (error) {
    const reason = error instanceof Error ? error.name : "unknown error";
    console.error(`[Context7] OAuth token check failed (${reason})`);
    return "unavailable";
  }
}

/**
 * Validate an opaque OAuth token against the Context7 API. Verdicts are cached
 * per token hash so the check runs at most about once a minute per token, and
 * concurrent requests carrying the same token share one check.
 */
export async function validateOpaqueOAuthToken(
  token: string,
  now = Date.now()
): Promise<OpaqueOAuthTokenVerdict> {
  const key = cacheKey(token);
  const cached = recall(key, now);
  if (cached) return cached;

  const pending = inFlight.get(key);
  if (pending) return pending;

  // The TTL counts from when the check started, so a slow check never extends
  // the window during which a stale verdict is served.
  const check = requestVerdict(token)
    .then((verdict) => {
      remember(key, verdict, now);
      return verdict;
    })
    .finally(() => {
      inFlight.delete(key);
    });
  inFlight.set(key, check);
  return check;
}

/**
 * The Context7 API rejected the token on a data request. Remember that so the
 * next MCP request gets the 401 immediately instead of waiting for the cached
 * positive verdict to expire.
 */
export function rememberInvalidOpaqueOAuthToken(token: string, now = Date.now()): void {
  remember(cacheKey(token), "invalid", now);
}

/** Test hook: drop every cached verdict and in-flight check. */
export function resetOpaqueOAuthTokenValidation(): void {
  verdicts.clear();
  inFlight.clear();
}
