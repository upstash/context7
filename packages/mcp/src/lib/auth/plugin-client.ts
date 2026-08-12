/**
 * True when the `client` query parameter identifies a plugin, e.g.
 * `?client=claude-code-plugin`.
 *
 * Plugin hosts (Claude Code marketplace plugins in particular) only start
 * OAuth for servers that 401 at connect time. The public `/mcp` endpoint stays
 * anonymous for everyone else; a `client` value containing `"plugin"` opts
 * that connection into the same auth gate as `/mcp/oauth`.
 */
export function isPluginClientQuery(client: unknown): boolean {
  const value = Array.isArray(client) ? client[0] : client;
  return typeof value === "string" && value.includes("plugin");
}
