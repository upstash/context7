import { createHmac } from "node:crypto";
import { extractClientInfoFromUserAgent } from "./utils.js";

export type McpAuthEvent =
  | "challenge_issued"
  | "credential_missing"
  | "credential_present"
  | "credential_rejected"
  | "credential_validated"
  | "metadata_requested";

export type McpAuthMethod = "api_key" | "jwt" | "none" | "oauth";

interface McpAuthEventInput {
  actorIp?: string;
  authMethod: McpAuthMethod;
  endpoint: string;
  event: McpAuthEvent;
  plugin?: string;
  userAgent?: string;
}

function anonymousActorId(ip: string | undefined): string | undefined {
  const secret = process.env.USAGE_ANONYMIZATION_SECRET;
  if (!ip || !secret) return undefined;

  return `anon_${createHmac("sha256", secret).update(ip).digest("hex").slice(0, 24)}`;
}

export function classifyAuthMethod(token: string | undefined): McpAuthMethod {
  if (!token) return "none";
  if (token.startsWith("oat_")) return "oauth";
  if (token.split(".").length === 3) return "jwt";
  return "api_key";
}

/**
 * Emits a bounded, privacy-safe event for the migration dashboard. Never log
 * credentials, OAuth state/codes, raw IPs, or the full user-agent string.
 */
export function logMcpAuthEvent(input: McpAuthEventInput): void {
  const clientInfo = extractClientInfoFromUserAgent(input.userAgent);
  console.log(
    JSON.stringify({
      level: "info",
      message: "mcp_auth_event",
      event: input.event,
      endpoint: input.endpoint,
      authMethod: input.authMethod,
      actorId: anonymousActorId(input.actorIp),
      clientIde: clientInfo?.ide,
      clientVersion: clientInfo?.version,
      plugin: input.plugin,
      source: "mcp-server",
    })
  );
}
