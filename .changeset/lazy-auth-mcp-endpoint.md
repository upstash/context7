---
"@upstash/context7-mcp": minor
---

Lazy authentication on the public `/mcp` endpoint. Anonymous clients can still connect, list tools and call public tools; the server now issues an OAuth challenge only when an unauthenticated caller invokes a protected tool or spends its anonymous allowance (`CONTEXT7_ANON_FREE_CALLS`, default 5).

The challenge is delivered in whichever shape the calling client acts on: an HTTP 401 with `WWW-Authenticate` for spec-compliant clients (Claude, VS Code, Cursor, Cline, Zed), or a `CallToolResult` carrying `_meta["mcp/www_authenticate"]` for ChatGPT and Codex, which do not raise their link-account UI from a bare 401. Tools also advertise `securitySchemes` in `tools/list` so OpenAI clients know they are callable before an account is linked.

This replaces the anonymous sign-in elicitation, which nudged the user with a `ctx7 setup` command instead of driving the client's own OAuth flow.
