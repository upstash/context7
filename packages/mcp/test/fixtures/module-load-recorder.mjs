const TELEMETRY_MODULE =
  /\/dist\/lib\/(?:mcp-operation-scope|mcp-telemetry|telemetry|telemetry-provider)\.js$/;

export async function load(url, context, nextLoad) {
  const pathname = url.startsWith("file:") ? new URL(url).pathname : "";
  if (TELEMETRY_MODULE.test(pathname) || pathname.includes("/node_modules/@opentelemetry/")) {
    process.stderr.write(`MCP_TELEMETRY_MODULE_LOADED ${url}\n`);
  }
  return nextLoad(url, context);
}
