/**
 * Codex resolves a server's auth mode from `bearer_token_env_var` or a header
 * literally named `Authorization` (`auth_status_before_discovery` in
 * codex-rs/rmcp-client/src/auth_status.rs, mirrored in `create_transport` in
 * rmcp_client.rs). Anything else falls through to an OAuth credential stored
 * against the same server name and URL, which Codex then refreshes at startup.
 * A dead refresh token fails the server before the API key is ever sent, and
 * rewriting config.toml cannot help because the credential lives elsewhere.
 *
 * Writing `Authorization` avoids that, but the credential stays in the store,
 * so setup points the user at the command that removes it.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const PROBE_TIMEOUT_MS = 1500;

/**
 * True when Codex reports it holds a usable OAuth credential for `serverName`.
 *
 * `codex mcp get --json` reports one of unsupported, not_logged_in,
 * bearer_token, or oauth. Only `oauth` proves a credential exists:
 * not_logged_in also covers "no credential, server merely advertises OAuth",
 * which is the normal state for anyone who never logged in.
 */
export function reportsStoredOAuthCredential(stdout: string): boolean {
  try {
    const parsed: unknown = JSON.parse(stdout);
    return (parsed as { auth_status?: unknown } | null)?.auth_status === "oauth";
  } catch {
    return false;
  }
}

/**
 * Warns that Codex is holding an OAuth credential that now goes unused, and
 * names the command that clears it.
 *
 * Best-effort: returns undefined when Codex is absent, the server is not
 * configured there, or the probe fails. Setup must not depend on this running.
 */
export async function codexStaleOAuthNote(serverName: string): Promise<string | undefined> {
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync("codex", ["mcp", "get", serverName, "--json"], {
      timeout: PROBE_TIMEOUT_MS,
      killSignal: "SIGKILL",
      encoding: "utf-8",
    }));
  } catch {
    return undefined;
  }

  if (!reportsStoredOAuthCredential(stdout)) return undefined;

  return `Codex has a stored OAuth credential for "${serverName}". It is no longer used, but you can clear it with: codex mcp logout ${serverName}`;
}
