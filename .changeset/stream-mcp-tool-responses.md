---
"@upstash/context7-mcp": patch
---

Stream MCP tool responses over SSE so HTTP headers flush before client `fetch` timeouts. Switching `enableJsonResponse` to `false` makes the SDK return the HTTP response synchronously after request validation, so headers are sent in milliseconds instead of being buffered until the tool completes. This fixes clients that cap the underlying `fetch` waiting for headers (e.g., Claude Code's 60s `wrapFetchWithTimeout`).
