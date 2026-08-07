/**
 * Mirrors, per anonymous client, the Context7 backend's verdict on whether that
 * client's free monthly requests are spent.
 *
 * The backend is the authority. It counts billable requests against
 * `ANONYMOUS_MONTHLY_QUOTA_LIMIT` keyed by the caller's IP — which this server
 * forwards as `mcp-client-ip` — and reports the balance on every `/api/v2`
 * response via `Context7-Quota-Tier` and `RateLimit-Remaining`. This module only
 * caches that answer so the lazy-auth gate can act on it before the next tool
 * call is proxied. It never counts requests itself: a second counter would
 * drift from the real quota and challenge users who still have requests left.
 *
 * The signal arrives on a response, which is too late to turn *that* request
 * into a 401 — the transport has already streamed a 200. So the verdict is
 * recorded on the response that reports it and consumed by the next request, at
 * the HTTP layer. In practice the handover is invisible, because the backend
 * reports `RateLimit-Remaining: 0` on the last allowed call: the following call
 * is challenged before the user ever sees a 429.
 *
 * The cache is in-process, deliberately. The MCP server is stateless (see
 * `createMcpHandler` in index.ts) and the package has no Redis client. Across
 * several instances each one learns the verdict independently, from the first
 * response it sees for that client, so the worst case is one extra proxied call
 * per instance per client — bounded, self-correcting, and cheaper than a
 * network round trip on every tool call. Because exhaustion is monotonic until
 * the quota resets, instances never disagree in a way that matters.
 */

/** Fallback lifetime when the backend does not say when the quota resets. */
const DEFAULT_TTL_MS = 60 * 60 * 1000;

/** Upper bound on a cached verdict, so a bad `RateLimit-Reset` can't pin a client out. */
const MAX_TTL_MS = 35 * 24 * 60 * 60 * 1000;

/**
 * Cap on tracked clients. Only exhausted clients are stored, so this stays far
 * below the number of callers; the bound exists so a burst of distinct
 * fingerprints cannot grow the map without limit.
 */
const MAX_ENTRIES = 50_000;

/** fingerprint -> epoch ms at which the recorded verdict stops applying. */
const exhaustedUntil = new Map<string, number>();

export interface QuotaSignal {
  /** `Context7-Quota-Tier`: the tier the backend actually billed this call to. */
  tier: string | null;
  /** `RateLimit-Remaining`: a count, or "unlimited". */
  remaining: string | null;
  /** `RateLimit-Reset`: absolute UTC epoch seconds (context7app sends the first of next month). */
  reset: string | null;
  /** The backend refused the call outright. */
  rejected: boolean;
}

export function readQuotaSignal(response: {
  status: number;
  headers: { get(name: string): string | null };
}): QuotaSignal {
  return {
    tier: response.headers.get("Context7-Quota-Tier"),
    remaining: response.headers.get("RateLimit-Remaining"),
    reset: response.headers.get("RateLimit-Reset"),
    rejected: response.status === 429,
  };
}

/**
 * Whether the backend billed this call to the anonymous tier. This — not the
 * presence of an `Authorization` header — is what decides whether a caller is
 * anonymous, because only the backend can tell a real credential from a string
 * that looks like one.
 */
export function isAnonymousTier(signal: QuotaSignal): boolean {
  return signal.tier === "anonymous";
}

/** Whether this response says the caller has nothing left to spend. */
export function signalsExhaustion(signal: QuotaSignal): boolean {
  // A 429 is checked first and independently of the tier: an edge rate limiter
  // or CDN can refuse the call before the backend attaches its quota headers,
  // and that refusal still means "stop sending anonymous traffic".
  if (signal.rejected) return true;
  if (!isAnonymousTier(signal)) return false;
  if (signal.remaining === null || signal.remaining === "unlimited") return false;
  const remaining = Number(signal.remaining);
  return Number.isInteger(remaining) && remaining <= 0;
}

function ttlMsFrom(resetHeader: string | null): number {
  const reset = Number(resetHeader);
  if (!Number.isFinite(reset) || reset <= 0) return DEFAULT_TTL_MS;
  const ms = reset * 1000 - Date.now();
  if (ms <= 0) return DEFAULT_TTL_MS;
  return Math.min(ms, MAX_TTL_MS);
}

/** Drop expired entries, then oldest-first if still over the cap. */
function evict(now: number): void {
  for (const [key, expiresAt] of exhaustedUntil) {
    if (expiresAt <= now) exhaustedUntil.delete(key);
  }
  // Map preserves insertion order, so the head is the least recently recorded.
  while (exhaustedUntil.size > MAX_ENTRIES) {
    const oldest = exhaustedUntil.keys().next();
    if (oldest.done) break;
    exhaustedUntil.delete(oldest.value);
  }
}

/** Record the backend's verdict for this client, or clear it if they are not anonymous. */
export function recordQuotaSignal(fingerprint: string | undefined, signal: QuotaSignal): void {
  if (!fingerprint) return;
  const now = Date.now();

  // A response the backend billed to a real plan proves this caller is not the
  // anonymous one we flagged, so any stale verdict for them is wrong. Note this
  // is keyed on what the backend reports, never on whether a credential was
  // presented — otherwise one signed-in user could clear the flag for every
  // anonymous caller sharing their NAT egress IP.
  if (signal.tier !== null && !isAnonymousTier(signal)) {
    exhaustedUntil.delete(fingerprint);
    return;
  }

  if (!signalsExhaustion(signal)) return;
  exhaustedUntil.set(fingerprint, now + ttlMsFrom(signal.reset));
  evict(now);
}

/** Whether the backend has reported this client's free requests spent. */
export function isQuotaExhausted(fingerprint: string | undefined): boolean {
  if (!fingerprint) return false;
  const expiresAt = exhaustedUntil.get(fingerprint);
  if (expiresAt === undefined) return false;
  if (expiresAt <= Date.now()) {
    exhaustedUntil.delete(fingerprint);
    return false;
  }
  return true;
}

/** Test seam. */
export function resetQuotaState(): void {
  exhaustedUntil.clear();
}
