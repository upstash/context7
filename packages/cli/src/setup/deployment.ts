import type { AuthOptions } from "./agents.js";
import { DEFAULT_CONTEXT7_BASE_URL } from "../utils/api.js";

const HOSTED_MCP_BASE_URL = "https://mcp.context7.com";

export type SetupDeployment =
  | { kind: "hosted"; baseUrl: typeof DEFAULT_CONTEXT7_BASE_URL }
  | { kind: "custom"; baseUrl: string };
export type CustomSetupDeployment = Extract<SetupDeployment, { kind: "custom" }>;

export function normalizeDeploymentBaseUrl(input?: string): string {
  const raw = input?.trim() || DEFAULT_CONTEXT7_BASE_URL;
  let url: URL;

  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Invalid Context7 base URL: ${raw}`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Context7 base URL must use http:// or https://");
  }
  if (url.username || url.password) {
    throw new Error("Context7 base URL must not contain credentials");
  }
  if (url.search || url.hash) {
    throw new Error("Context7 base URL must not contain a query string or fragment");
  }

  url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  const normalized = url.toString().replace(/\/$/, "");
  if (url.pathname.endsWith("/mcp") || url.pathname.endsWith("/api")) {
    throw new Error("Pass the Context7 deployment root, without /mcp or /api");
  }
  return normalized;
}

export function resolveSetupDeployment(input?: string): SetupDeployment {
  const baseUrl = normalizeDeploymentBaseUrl(input);
  return baseUrl === DEFAULT_CONTEXT7_BASE_URL
    ? { kind: "hosted", baseUrl: DEFAULT_CONTEXT7_BASE_URL }
    : { kind: "custom", baseUrl };
}

export function getMcpUrl(deployment: SetupDeployment, auth: AuthOptions): string {
  if (deployment.kind === "hosted") {
    return auth.mode === "oauth"
      ? `${HOSTED_MCP_BASE_URL}/mcp/oauth`
      : `${HOSTED_MCP_BASE_URL}/mcp`;
  }
  return `${deployment.baseUrl}/mcp`;
}

/** Which credentials the on-premise /mcp endpoint accepts. Servers before OAuth report no mode. */
export type OnPremMcpAuthMode = "personal_keys" | "oauth" | "both";

export interface OnPremMcpAuthStatus {
  enabled: boolean;
  mode: OnPremMcpAuthMode;
}

export async function getOnPremMcpAuthStatus(
  deployment: CustomSetupDeployment
): Promise<OnPremMcpAuthStatus> {
  const response = await fetch(`${deployment.baseUrl}/api/auth/mcp`, {
    headers: { Accept: "application/json" },
    redirect: "manual",
    signal: AbortSignal.timeout(10_000),
  });

  if (response.status >= 300 && response.status < 400) {
    throw new Error(
      `Authentication discovery was redirected. Pass the final deployment URL instead of ${deployment.baseUrl}.`
    );
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${deployment.baseUrl}/api/auth/mcp`);
  }

  const body = (await response.json()) as { enabled?: unknown; mode?: unknown };
  if (typeof body.enabled !== "boolean") {
    throw new Error(`Invalid response from ${deployment.baseUrl}/api/auth/mcp`);
  }
  const mode: OnPremMcpAuthMode =
    body.mode === "oauth" || body.mode === "both" ? body.mode : "personal_keys";
  return { enabled: body.enabled, mode };
}
