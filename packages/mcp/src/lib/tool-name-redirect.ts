import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import type { IncomingHttpHeaders } from "node:http";
import { GET_LIBRARY_DOCS_TOOL, QUERY_DOCS_TOOL } from "./tool-names.js";

// Rewrite only the tool name. The SDK still validates the request and arguments.
function redirectToolCall(message: unknown): boolean {
  if (
    !message ||
    typeof message !== "object" ||
    !("method" in message) ||
    message.method !== "tools/call" ||
    !("params" in message) ||
    !message.params ||
    typeof message.params !== "object" ||
    !("name" in message.params) ||
    message.params.name !== GET_LIBRARY_DOCS_TOOL
  ) {
    return false;
  }

  message.params.name = QUERY_DOCS_TOOL;
  return true;
}

/** Redirect old tool names before HTTP dispatch, preserving header validation. */
export function redirectHttpToolCalls(request: {
  body: unknown;
  headers: IncomingHttpHeaders;
}): void {
  const name = request.headers["mcp-name"];
  // Leave mismatched headers untouched so the SDK can reject the request.
  if (name !== undefined && name !== GET_LIBRARY_DOCS_TOOL) return;

  const messages = Array.isArray(request.body) ? request.body : [request.body];
  for (const message of messages) {
    if (redirectToolCall(message) && name === GET_LIBRARY_DOCS_TOOL) {
      request.headers["mcp-name"] = QUERY_DOCS_TOOL;
    }
  }
}

/** Redirect old tool names before the stdio server receives each request. */
export class ToolNameRedirectStdioTransport extends StdioServerTransport {
  /** Install the redirect after the server assigns its callback, before input starts. */
  override start(): Promise<void> {
    const onmessage = this.onmessage;
    this.onmessage = (message) => {
      redirectToolCall(message);
      onmessage?.(message);
    };
    return super.start();
  }
}
