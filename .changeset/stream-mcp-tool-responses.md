---
"@upstash/context7-mcp": patch
---

Restore `researchMode` on `query-docs` and emit `notifications/progress` every 20s while the upstream call is in flight, so MCP clients that opt into `resetTimeoutOnProgress` keep their per-request timer alive past the SDK's 60s default. Also create a fresh `McpServer` per HTTP request so concurrent short requests can no longer clear the shared `Protocol._transport` and break in-flight long-running tool calls.
