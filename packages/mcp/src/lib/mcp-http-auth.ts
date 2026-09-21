import type { Request, Response } from "express";
import { EMA_ISSUER, OAUTH_AUTH_SERVER_URL, RESOURCE_URL } from "./constants.js";
import { classifyAuthMethod, type McpAuthEvent, type McpAuthMethod } from "./auth-telemetry.js";
import { isJWT, validateJWT } from "./jwt.js";
import type { AuthenticationOutcome } from "./telemetry-contracts.js";

export type McpAuthMode = "observe" | "required";
export type McpEndpoint = "/mcp" | "/mcp/oauth";

export interface McpAuthDecision {
  allowed: boolean;
  authMethod: McpAuthMethod;
  error?: string;
  event: McpAuthEvent;
  outcome: AuthenticationOutcome;
}

export function parseMcpAuthMode(raw = process.env.MCP_AUTH_ENFORCEMENT): McpAuthMode {
  const value = raw?.trim().toLowerCase();
  if (!value) return "observe";
  if (value === "observe" || value === "required") return value;
  throw new Error(`MCP_AUTH_ENFORCEMENT must be "observe" or "required"; received "${raw}"`);
}

/**
 * Decide whether the HTTP request may reach the MCP transport. JWTs can be
 * verified at this boundary. Opaque OAuth tokens and API keys are recorded as
 * present, then authoritatively validated by the Context7 API before data is
 * returned.
 */
export async function evaluateMcpAuthentication(
  token: string | undefined,
  mode: McpAuthMode
): Promise<McpAuthDecision> {
  const authMethod = classifyAuthMethod(token);
  if (!token) {
    const allowed = mode === "observe";
    return {
      allowed,
      authMethod,
      error: "Authentication required. Please authenticate to use this MCP server.",
      event: allowed ? "credential_missing" : "challenge_issued",
      outcome: "missing",
    };
  }

  if (!isJWT(token)) {
    return {
      allowed: true,
      authMethod,
      event: "credential_present",
      outcome: "accepted",
    };
  }

  const validation = await validateJWT(token);
  if (!validation.valid) {
    return {
      allowed: false,
      authMethod,
      error: validation.error || "Invalid token. Please re-authenticate.",
      event: "credential_rejected",
      outcome: "invalid",
    };
  }

  return {
    allowed: true,
    authMethod,
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
