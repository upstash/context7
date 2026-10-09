import type { Request, Response } from "express";
import { EMA_ISSUER, OAUTH_AUTH_SERVER_URL, RESOURCE_URL } from "./constants.js";
import { isClerkOAuthJwt, isJWT, validateJWT } from "./jwt.js";
import { createPerTokenLogWindow } from "./log-throttle.js";
import {
  EXPIRED_OAUTH_TOKEN_ERROR,
  isOAuthTokenRememberedInvalid,
  isOpaqueOAuthToken,
  isOpaqueOAuthTokenValidationEnabled,
  validateOpaqueOAuthToken,
} from "./oauth-token-validation.js";
import type { AuthenticationObservation, AuthenticationMethod } from "./telemetry-contracts.js";

export type McpAuthMode = "observe" | "required";
export type McpEndpoint = "/mcp" | "/mcp/oauth";

export type McpAuthDecision = AuthenticationObservation &
  ({ allowed: true } | { allowed: false; error: string });

// A JWT from a grant authorized before Clerk's "Include Audience" setting was
// on has no `aud` on every refresh, so its warning would repeat on every MCP
// request (millions of lines a day). One line per token per window is enough
// to collect the (clientId, aud) pairs before enforcement.
const JWT_WARNING_WINDOW_MS = 10 * 60_000;
const jwtWarningLog = createPerTokenLogWindow(JWT_WARNING_WINDOW_MS);

/** Test hook: forget which tokens have had their warning logged. */
export function resetJwtWarningLog(): void {
  jwtWarningLog.reset();
}

/**
 * A Clerk OAuth JWT counts as `oauth` like the opaque `oat_` token it replaces,
 * so OAuth telemetry stays continuous across the switch to JWT access tokens.
 * `jwt` is left for Entra, EMA, Vercel Marketplace and unrecognised JWTs.
 */
export function classifyAuthMethod(token: string | undefined): AuthenticationMethod {
  if (!token) return "none";
  if (isOpaqueOAuthToken(token) || isClerkOAuthJwt(token)) return "oauth";
  if (isJWT(token)) return "jwt";
  return "api_key";
}

export function parseMcpAuthMode(raw = process.env.MCP_AUTH_ENFORCEMENT): McpAuthMode {
  const value = raw?.trim().toLowerCase();
  if (!value) return "required";
  if (value === "observe" || value === "required") return value;
  throw new Error(`MCP_AUTH_ENFORCEMENT must be "observe" or "required"; received "${raw}"`);
}

/**
 * Clients of `/mcp/oauth` and the Claude Code plugin start OAuth only after a
 * 401, so they keep that challenge in observe mode and observation covers only
 * the plain `/mcp` route. An empty plugin Authorization header comes from older
 * plugin versions that expanded an unset API key; it stays anonymous until
 * enforcement is required.
 */
export function effectiveMcpAuthMode(
  mode: McpAuthMode,
  endpoint: McpEndpoint,
  plugin: string | undefined,
  authorizationHeader: string | undefined
): McpAuthMode {
  if (mode === "required" || endpoint === "/mcp/oauth") return "required";
  return plugin && authorizationHeader !== "" ? "required" : "observe";
}

/**
 * Decide whether the HTTP request may reach the MCP transport. JWTs are
 * verified at this boundary. Opaque OAuth tokens are checked against the
 * Context7 API (cached per token) so an expired sign-in gets the HTTP 401 that
 * makes MCP clients refresh it; the check fails open. A Clerk OAuth JWT is
 * verified locally (signature, issuer, type, audience) with no API call, and
 * only a rejection the Context7 API returned on an earlier data request can
 * still turn it away. API keys are recorded as present, then authoritatively
 * validated by the Context7 API before data is returned.
 */
export async function evaluateMcpAuthentication(
  token: string | undefined,
  mode: McpAuthMode
): Promise<McpAuthDecision> {
  const method = classifyAuthMethod(token);
  if (!token) {
    return mode === "observe"
      ? { allowed: true, method, event: "credential_missing", outcome: "missing" }
      : {
          allowed: false,
          method,
          error: "Authentication required. Please authenticate to use this MCP server.",
          event: "challenge_issued",
          outcome: "missing",
        };
  }

  if (isOpaqueOAuthToken(token) && isOpaqueOAuthTokenValidationEnabled()) {
    const verdict = await validateOpaqueOAuthToken(token);
    if (verdict === "invalid") {
      return {
        allowed: false,
        method,
        error: EXPIRED_OAUTH_TOKEN_ERROR,
        event: "credential_rejected",
        outcome: "expired",
      };
    }
    return verdict === "valid"
      ? { allowed: true, method, event: "credential_validated", outcome: "accepted" }
      : { allowed: true, method, event: "credential_present", outcome: "unverified" };
  }

  if (!isJWT(token)) {
    return {
      allowed: true,
      method,
      event: "credential_present",
      outcome: "accepted",
    };
  }

  if (isClerkOAuthJwt(token) && isOAuthTokenRememberedInvalid(token)) {
    return {
      allowed: false,
      method,
      error: EXPIRED_OAUTH_TOKEN_ERROR,
      event: "credential_rejected",
      outcome: "expired",
    };
  }

  const validation = await validateJWT(token);
  if (validation.warning) {
    // Names the OAuth client and the audience, never the token. The verdict
    // below is still applied on every request; only the line is deduplicated.
    const suppressed = jwtWarningLog.admit(token);
    if (suppressed !== undefined) {
      console.error(`[Context7] ${validation.warning} suppressedSincePrevious=${suppressed}`);
    }
  }
  if (!validation.valid) {
    return {
      allowed: false,
      method,
      error: validation.error || "Invalid token. Please re-authenticate.",
      event: "credential_rejected",
      // An expired Clerk access token is the JWT form of an expired `oat_`:
      // the client refreshes it after this 401.
      outcome: method === "oauth" && validation.error === "Token expired" ? "expired" : "invalid",
    };
  }

  return {
    allowed: true,
    method,
    event: "credential_validated",
    outcome: "accepted",
  };
}

export function canonicalMcpEndpoint(req: Request): McpEndpoint {
  return `${req.baseUrl}${req.path}`.replace(/\/$/, "") === "/mcp/oauth" ? "/mcp/oauth" : "/mcp";
}

export function protectedResourceUrl(endpoint: McpEndpoint): string {
  return new URL(endpoint, new URL(RESOURCE_URL).origin).toString();
}

function protectedResourceMetadataUrl(endpoint: McpEndpoint): string {
  return new URL(`/.well-known/oauth-protected-resource${endpoint}`, RESOURCE_URL).toString();
}

export function setBearerChallenge(
  res: Response,
  endpoint: McpEndpoint,
  errorDescription?: string
): void {
  const parameters = [`resource_metadata="${protectedResourceMetadataUrl(endpoint)}"`];
  if (errorDescription) {
    const description = errorDescription.replace(/["\\]/g, "");
    parameters.unshift(`error="invalid_token"`, `error_description="${description}"`);
  }
  res.set("WWW-Authenticate", `Bearer ${parameters.join(", ")}`);
}

export function protectedResourceMetadata(resource: string) {
  return {
    resource,
    // Each entry is an independent authorization server. Clerk handles
    // regular authorization-code flows; Context7 handles only the
    // enterprise-managed id-jag exchange.
    authorization_servers: Array.from(new Set([OAUTH_AUTH_SERVER_URL, EMA_ISSUER])),
    scopes_supported: ["profile", "email"],
    bearer_methods_supported: ["header"],
  };
}
