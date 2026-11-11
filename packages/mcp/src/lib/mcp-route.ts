export type McpRoute = "anonymous" | "oauth" | "stdio";
export type McpHttpRoute = Exclude<McpRoute, "stdio">;

export function mcpRouteFromUrl(url: string): McpHttpRoute {
  const pathname = new URL(url, "http://localhost").pathname.replace(/\/+$/, "").toLowerCase();
  return pathname === "/mcp/oauth" ? "oauth" : "anonymous";
}
