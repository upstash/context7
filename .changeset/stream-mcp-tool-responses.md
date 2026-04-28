---
"@upstash/context7-mcp": patch
---

Stream tool-call responses over SSE so headers flush before clients hit their fetch timeout. Long-running tools (notably `query-docs` with `researchMode: true`) previously kept the HTTP response buffered until the upstream call finished, causing MCP HTTP clients with a per-request fetch cap (e.g., Claude Code's 60s `wrapFetchWithTimeout`) to give up before headers arrived. Switching `enableJsonResponse` to `false` makes the SDK return the response synchronously after request validation; the body streams while the tool runs.
