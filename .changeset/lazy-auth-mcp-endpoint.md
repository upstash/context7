---
"@upstash/context7-mcp": minor
---

Lazy authentication on the public `/mcp` endpoint. Anonymous clients still connect, list tools and call tools exactly as before; the server now answers with an OAuth challenge, rather than a rate-limit error, once a caller has spent the free monthly requests for their machine or invokes a tool listed in `CONTEXT7_PROTECTED_TOOLS`.

The quota trigger defers to the Context7 backend, which already counts anonymous requests per client IP and reports the balance on every response (`Context7-Quota-Tier`, `RateLimit-Remaining`). The MCP server mirrors that verdict instead of counting separately, so the challenge fires exactly when the real quota runs out. Because the balance is known one request ahead, the challenge is issued before the call is proxied: users get a sign-in prompt instead of a 429, and the refused call costs no quota.

The challenge is delivered in whichever shape the calling client acts on: an HTTP 401 with `WWW-Authenticate` for spec-compliant clients (Claude, VS Code, Cursor, Cline, Zed, Codex CLI), or a `CallToolResult` carrying `_meta["mcp/www_authenticate"]` for ChatGPT, which does not raise its link-account UI from a bare 401. Tools also advertise `securitySchemes` in their `_meta` so clients know they are callable before an account is linked.

Note that whether the sign-in prompt opens by itself is up to the client. Claude, Claude Desktop and ChatGPT show an inline connect card and retry the call automatically; terminal clients flag the server and expect the user to start the flow (`/mcp` in Claude Code, `codex mcp login` in Codex CLI).

This replaces the anonymous sign-in elicitation, which interrupted the turn to ask the user to run `ctx7 setup` in a terminal instead of driving the client's own OAuth flow.
