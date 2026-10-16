---
"@upstash/context7-mcp": patch
---

Update the MCP SDK to `@modelcontextprotocol/server` 2.3.1 and `@modelcontextprotocol/node` 2.1.1, which converts tool schemas lazily, so each per-request server costs less to build. On the 2026-07-28 protocol, `tools/list`, `prompts/list`, `resources/list`, `resources/templates/list` and `server/discover` now return `ttlMs: 3600000` and `cacheScope: "public"`, so clients can reuse them for an hour instead of listing on every request. `resolve-library-id` now sets `isError: true` when the library search fails; a search with no matches is still a normal result.

On SIGTERM the HTTP server now finishes the requests on open connections before it closes the MCP handler, and answers them with `Connection: close`. Before, those requests got HTTP 499 or 500 from the closed handler, and the shutdown hit its 5 s limit and exited with code 1. The SDK's rejections of malformed client requests are now logged as one line without a stack trace.
