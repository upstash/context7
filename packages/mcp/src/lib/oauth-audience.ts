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

export type OAuthAudienceEnforcement = "observe" | "required";

/** The forms of the MCP resource identifier clients have been seen to request. */
export function defaultOAuthAllowedAudiences(resourceUrl = RESOURCE_URL): string[] {
  const origin = new URL(resourceUrl).origin;
  return [origin, `${origin}/mcp`, `${origin}/mcp/oauth`];
}

/**
 * Canonical form of an audience for comparison: lowercase scheme and host,
 * default port dropped, fragment dropped, no trailing slash. The path keeps
 * its case. A value that is not an http(s) URL is only trimmed, since it can
 * never match an allowed audience and matters only in the log.
 */
export function normalizeAudience(value: string): string {
  const trimmed = value.trim();
  let normalized = trimmed;
  try {
    const url = new URL(trimmed);
    if (url.protocol === "http:" || url.protocol === "https:") {
      normalized = `${url.protocol}//${url.host}${url.pathname}${url.search}`;
    }
  } catch {
    // Not a URL; compared and logged as written.
  }
  return normalized.replace(/\/+$/, "");
}

/**
 * `observe` (default) accepts a token whose `aud` is missing or not allowed
 * and only logs the mismatch; `required` answers 401. Unknown values throw so
 * a typo is caught at startup rather than silently staying in observe.
 */
export function parseOAuthAudienceEnforcement(
  raw = process.env.MCP_OAUTH_AUDIENCE_ENFORCEMENT
): OAuthAudienceEnforcement {
  const value = raw?.trim().toLowerCase();
  if (!value) return "observe";
  if (value === "observe" || value === "required") return value;
  throw new Error(
    `MCP_OAUTH_AUDIENCE_ENFORCEMENT must be "observe" or "required"; received "${raw}"`
  );
}

export function getAllowedOAuthAudiences(
  raw = process.env.MCP_OAUTH_ALLOWED_AUDIENCES
): Set<string> {
  const configured = raw?.trim();
  const values = configured ? configured.split(",") : defaultOAuthAllowedAudiences();
  return new Set(
    values
      .map((value) => value.trim())
      .filter(Boolean)
      .map(normalizeAudience)
  );
}

export interface OAuthAudienceCheck {
  /** At least one of the token's audiences is allowed. */
  allowed: boolean;
  /** The normalized audiences, comma-joined, or `missing`. Safe to log. */
  aud: string;
  enforcement: OAuthAudienceEnforcement;
}

/**
 * Checks a verified token's `aud` against the allowed audiences. A token with
 * no `aud` fails the check like a foreign one: the client asked for no
 * resource, so nothing says the token was meant for this server.
 */
export function checkOAuthAudience(audiences: unknown): OAuthAudienceCheck {
  const enforcement = parseOAuthAudienceEnforcement();
  const list =
    typeof audiences === "string"
      ? [audiences]
      : Array.isArray(audiences)
        ? audiences.filter((value): value is string => typeof value === "string")
        : [];
  const normalized = list.map(normalizeAudience).filter(Boolean);
  if (normalized.length === 0) {
    return { allowed: false, aud: "missing", enforcement };
  }
  const allowed = getAllowedOAuthAudiences();
  return {
    allowed: normalized.some((audience) => allowed.has(audience)),
    aud: normalized.join(","),
    enforcement,
  };
}
