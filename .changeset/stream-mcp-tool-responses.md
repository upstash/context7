---
"@upstash/context7-mcp": patch
---

Keep long-running MCP tool calls (notably `query-docs` with `researchMode: true`) alive past client timeouts.

Two server-side changes work together:

- **Stream tool responses over SSE.** Switching `enableJsonResponse` to `false` makes the SDK return the HTTP response synchronously after request validation, so headers flush in milliseconds instead of being buffered until the tool completes. Fixes clients that cap the underlying `fetch` waiting for headers (e.g., Claude Code's 60s `wrapFetchWithTimeout`).
- **Emit periodic `notifications/progress` from `query-docs`.** Resets the JSON-RPC request timer on clients that pass `resetTimeoutOnProgress: true` (e.g., opencode), which would otherwise hit the MCP SDK's default 60s `DEFAULT_REQUEST_TIMEOUT_MSEC` regardless of byte flow.

Clients that don't include a `progressToken` simply never see the notifications — no behavior change for them.
