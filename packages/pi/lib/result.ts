import type { AgentToolResult } from "@earendil-works/pi-coding-agent";

export function toToolResult(text: string): AgentToolResult<undefined> {
  return {
    content: [{ type: "text", text }],
    details: undefined,
  };
}
