import { RESOURCE_URL } from "./constants.js";

/**
 * Audience check for the OAuth JWT access tokens Clerk issues to the hosted
 * MCP server's clients.
 *
 * An MCP client asks the authorization server for a token bound to the server
 * it is talking to (RFC 8707 `resource`), and Clerk records that value as the
 * token's `aud`. The MCP authorization spec requires the resource server to
 * accept only tokens issued for it; otherwise a token obtained by any other
 * MCP server that points its metadata at our Clerk instance would work here.
 *
 * The comparison is done in our code, not by jose's `audience` option, so a
 * mismatch can be observed before it is enforced. Names and normalization
 * match `lib/auth/oauthAudience.ts` in context7app so both servers agree on
 * which tokens are ours.
 */

/**
 * - `observe` (default): every mismatch is logged and accepted.
 * - `foreign`: a present `aud` that is not allowed is rejected; a missing
 *   `aud` is logged and accepted. Grants authorized before Clerk's "Include
 *   Audience" setting was on carry no `aud`, and Clerk keeps it empty on
 *   refresh, so `missing` stays accepted until those grants are handled.
 * - `required`: a foreign and a missing `aud` are both rejected.
 */
export type OAuthAudienceEnforcement = "observe" | "foreign" | "required";

export type OAuthAudienceOutcome = "accepted" | "rejected";

const ENFORCEMENT_MODES: readonly OAuthAudienceEnforcement[] = ["observe", "foreign", "required"];

/** Shown to a client whose token was issued for another resource server. */
export const FOREIGN_OAUTH_AUDIENCE_MESSAGE =
  "This token was issued for another server. If you connect through a gateway or proxy, use a Context7 API key instead.";

/** The forms of the MCP resource identifier clients have been seen to request. */
export function defaultOAuthAllowedAudiences(resourceUrl = RESOURCE_URL): string[] {
  const origin = new URL(resourceUrl).origin;
  return [origin, `${origin}/mcp`, `${origin}/mcp/oauth`];
}

export interface NormalizeAudienceOptions {
  /**
   * Hosts whose query string is not part of the audience. Cursor writes the
   * MCP URL as it was configured into `resource`, so our own server's
   * audience arrives as `https://mcp.context7.com/mcp?client=codex`. On any
   * other host the query string stays, so a foreign audience is logged as
   * the client sent it.
   */
  queryIgnoredHosts?: ReadonlySet<string>;
}

/**
 * Canonical form of an audience for comparison: lowercase scheme and host,
 * default port dropped, fragment dropped, no trailing slash. The path keeps
 * its case. A value that is not an http(s) URL is only trimmed, since it can
 * never match an allowed audience and matters only in the log.
 */
export function normalizeAudience(value: string, options: NormalizeAudienceOptions = {}): string {
  const trimmed = value.trim();
  let normalized = trimmed;
  try {
    const url = new URL(trimmed);
    if (url.protocol === "http:" || url.protocol === "https:") {
      const search = options.queryIgnoredHosts?.has(url.host) ? "" : url.search;
      normalized = `${url.protocol}//${url.host}${url.pathname}${search}`;
    }
  } catch {
    // Not a URL; compared and logged as written.
  }
  return normalized.replace(/\/+$/, "");
}

/**
 * `observe` (default) accepts a token whose `aud` is missing or not allowed
 * and only logs the mismatch; `foreign` answers 401 to a token issued for
 * another server and still accepts a missing `aud`; `required` answers 401
 * to both. Unknown values throw so a typo is caught at startup rather than
 * silently staying in observe.
 */
export function parseOAuthAudienceEnforcement(
  raw = process.env.MCP_OAUTH_AUDIENCE_ENFORCEMENT
): OAuthAudienceEnforcement {
  const value = raw?.trim().toLowerCase();
  if (!value) return "observe";
  const mode = ENFORCEMENT_MODES.find((candidate) => candidate === value);
  if (mode) return mode;
  throw new Error(
    `MCP_OAUTH_AUDIENCE_ENFORCEMENT must be "observe", "foreign" or "required"; received "${raw}"`
  );
}

export function getAllowedOAuthAudiences(
  raw = process.env.MCP_OAUTH_ALLOWED_AUDIENCES
): Set<string> {
  const configured = raw?.trim();
  const values = (configured ? configured.split(",") : defaultOAuthAllowedAudiences())
    .map((value) => value.trim())
    .filter(Boolean);
  // A token's audience on an allowed host loses its query string before the
  // comparison, so a configured entry drops its own too; otherwise
  // `https://x.example/mcp?a=1` in the list could never match.
  const queryIgnoredHosts = getAllowedOAuthAudienceHosts(
    new Set(values.map((value) => normalizeAudience(value)))
  );
  return new Set(values.map((value) => normalizeAudience(value, { queryIgnoredHosts })));
}

/** The hosts of the allowed http(s) audiences, as `URL.host` spells them. */
export function getAllowedOAuthAudienceHosts(
  allowed: ReadonlySet<string> = getAllowedOAuthAudiences()
): Set<string> {
  const hosts = new Set<string>();
  for (const audience of allowed) {
    try {
      const url = new URL(audience);
      if (url.protocol === "http:" || url.protocol === "https:") {
        hosts.add(url.host);
      }
    } catch {
      // Not a URL; it has no host.
    }
  }
  return hosts;
}

export interface OAuthAudienceCheck {
  /** At least one of the token's audiences is allowed. */
  allowed: boolean;
  /** The normalized audiences, comma-joined, or `missing`. Safe to log. */
  aud: string;
  enforcement: OAuthAudienceEnforcement;
  /** What the enforcement mode makes of the verdict. */
  outcome: OAuthAudienceOutcome;
}

function decideOutcome(
  enforcement: OAuthAudienceEnforcement,
  allowed: boolean,
  missing: boolean
): OAuthAudienceOutcome {
  if (allowed) return "accepted";
  switch (enforcement) {
    case "observe":
      return "accepted";
    case "foreign":
      return missing ? "accepted" : "rejected";
    case "required":
      return "rejected";
  }
}

/**
 * Checks a verified token's `aud` against the allowed audiences. A token with
 * no `aud` fails the check like a foreign one: the client asked for no
 * resource, so nothing says the token was meant for this server. Whether the
 * failure rejects the token is the enforcement mode's decision (`outcome`).
 */
export function checkOAuthAudience(audiences: unknown): OAuthAudienceCheck {
  const enforcement = parseOAuthAudienceEnforcement();
  const allowedAudiences = getAllowedOAuthAudiences();
  const queryIgnoredHosts = getAllowedOAuthAudienceHosts(allowedAudiences);
  const list =
    typeof audiences === "string"
      ? [audiences]
      : Array.isArray(audiences)
        ? audiences.filter((value): value is string => typeof value === "string")
        : [];
  const normalized = list
    .map((audience) => normalizeAudience(audience, { queryIgnoredHosts }))
    .filter(Boolean);
  if (normalized.length === 0) {
    return {
      allowed: false,
      aud: "missing",
      enforcement,
      outcome: decideOutcome(enforcement, false, true),
    };
  }
  const allowed = normalized.some((audience) => allowedAudiences.has(audience));
  return {
    allowed,
    aud: normalized.join(","),
    enforcement,
    outcome: decideOutcome(enforcement, allowed, false),
  };
}
