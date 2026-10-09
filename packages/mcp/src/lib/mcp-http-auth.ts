import type { Request, Response } from "express";
import { EMA_ISSUER, OAUTH_AUTH_SERVER_URL, RESOURCE_URL } from "./constants.js";
import { isJWT, validateJWT } from "./jwt.js";
import {
  EXPIRED_OAUTH_TOKEN_ERROR,
  isOpaqueOAuthToken,
  isOpaqueOAuthTokenValidationEnabled,
  validateOpaqueOAuthToken,
} from "./oauth-token-validation.js";
import type { AuthenticationObservation, AuthenticationMethod } from "./telemetry-contracts.js";

export type McpAuthMode = "observe" | "required";
export type McpEndpoint = "/mcp" | "/mcp/oauth";

export type McpAuthDecision = AuthenticationObservation &
  ({ allowed: true } | { allowed: false; error: string });

export function classifyAuthMethod(token: string | undefined): AuthenticationMethod {
  if (!token) return "none";
  if (isOpaqueOAuthToken(token)) return "oauth";
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
 * makes MCP clients refresh it; the check fails open. API keys are recorded as
 * present, then authoritatively validated by the Context7 API before data is
 * returned.
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

  const validation = await validateJWT(token);
  if (!validation.valid) {
    return {
      allowed: false,
      method,
      error: validation.error || "Invalid token. Please re-authenticate.",
      event: "credential_rejected",
      outcome: "invalid",
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
