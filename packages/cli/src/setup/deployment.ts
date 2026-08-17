import type { AuthOptions } from "./agents.js";

export const HOSTED_CONTEXT7_BASE_URL = "https://context7.com";
const HOSTED_MCP_BASE_URL = "https://mcp.context7.com";

export type SetupDeployment =
  | { kind: "hosted"; baseUrl: typeof HOSTED_CONTEXT7_BASE_URL }
  | { kind: "custom"; baseUrl: string };
export type CustomSetupDeployment = Extract<SetupDeployment, { kind: "custom" }>;

export function normalizeDeploymentBaseUrl(input?: string): string {
  const raw = input?.trim() || HOSTED_CONTEXT7_BASE_URL;
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
  return baseUrl === HOSTED_CONTEXT7_BASE_URL
    ? { kind: "hosted", baseUrl: HOSTED_CONTEXT7_BASE_URL }
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

export async function getOnPremMcpAuthStatus(
  deployment: CustomSetupDeployment
): Promise<{ enabled: boolean }> {
  const response = await fetch(`${deployment.baseUrl}/api/auth/mcp`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${deployment.baseUrl}/api/auth/mcp`);
  }

  const body = (await response.json()) as { enabled?: unknown };
  if (typeof body.enabled !== "boolean") {
    throw new Error(`Invalid response from ${deployment.baseUrl}/api/auth/mcp`);
  }
  return { enabled: body.enabled };
}
