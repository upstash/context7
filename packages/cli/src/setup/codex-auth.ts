import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const CODEX_PROBE_TIMEOUT_MS = 5000;

/**
 * Auth modes Codex reports for a configured MCP server. Mirrors
 * `McpAuthStatus` in codex-rs/protocol/src/protocol.rs, which serializes
 * snake_case.
 */
export type CodexAuthStatus = "unsupported" | "not_logged_in" | "bearer_token" | "oauth";

const KNOWN_STATUSES: readonly string[] = [
  "unsupported",
  "not_logged_in",
  "bearer_token",
  "oauth",
] satisfies readonly CodexAuthStatus[];

export function parseCodexAuthStatus(stdout: string): CodexAuthStatus | undefined {
  try {
    const parsed: unknown = JSON.parse(stdout);
    if (!parsed || typeof parsed !== "object") return undefined;
    const status = (parsed as { auth_status?: unknown }).auth_status;
    return typeof status === "string" && KNOWN_STATUSES.includes(status)
      ? (status as CodexAuthStatus)
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Asks Codex what auth mode it currently resolves for `serverName`.
 *
 * Best-effort only: returns undefined when Codex is not installed, the server
 * is not configured yet, or the probe fails for any other reason. Setup must
 * never fail because this could not run.
 */
export async function readCodexAuthStatus(
  serverName: string
): Promise<CodexAuthStatus | undefined> {
  try {
    const { stdout } = await execFileAsync("codex", ["mcp", "get", serverName, "--json"], {
      timeout: CODEX_PROBE_TIMEOUT_MS,
      encoding: "utf-8",
    });
    return parseCodexAuthStatus(stdout);
  } catch {
    return undefined;
  }
}

/**
 * True when Codex is holding an OAuth credential for a server we are about to
 * configure with an API key.
 *
 * Codex keys stored OAuth credentials by server name + URL and ignores custom
 * header names when deciding whether a server is an OAuth server, so a stale
 * credential can shadow the API key and fail startup on a dead refresh token.
 * Writing an `Authorization` header stops Codex reading that credential, but it
 * stays in the credential store until the user clears it.
 */
export function hasStaleOAuthCredential(status: CodexAuthStatus | undefined): boolean {
  return status === "oauth" || status === "not_logged_in";
}

export function staleOAuthCredentialHint(serverName: string): string {
  return `Codex has a stored OAuth credential for "${serverName}". It is no longer used, but you can clear it with: codex mcp logout ${serverName}`;
}
