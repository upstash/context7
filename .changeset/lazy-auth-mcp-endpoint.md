---
"@upstash/context7-mcp": major
---

The public `/mcp` endpoint now asks clients to authenticate when they connect.

**This is a breaking change for anonymous users.** A client with no credentials that previously connected and called tools now receives a `401` with a `WWW-Authenticate` challenge on its first request. Set `CONTEXT7_MCP_AUTH_MODE=lazy` to restore the previous behaviour, with anonymous callers spending their free monthly requests before being challenged.

The default is `required` because that is when MCP clients actually run OAuth. Codex starts the flow as soon as it discovers the resource metadata, Claude Code exposes its authorize helpers for servers flagged at session start, and Zed raises its prompt on a startup 401. The same challenge raised mid-conversation is handled far worse: it fails the turn in progress, and the recovery path often only appears in the next session. Signing in at connect time means the user gets their client's native prompt instead of a broken request.

In `lazy` mode the quota trigger defers to the Context7 backend, which already counts anonymous requests per client IP and reports the balance on every response (`Context7-Quota-Tier`, `RateLimit-Remaining`). The MCP server mirrors that verdict rather than counting separately, and because the balance is known one request ahead the challenge is issued before the call is proxied — so users get a sign-in prompt instead of a 429, and the refused call costs no quota.

Either mode delivers the challenge in whichever shape the calling client acts on: an HTTP 401 with `WWW-Authenticate` for spec-compliant clients, or a `CallToolResult` carrying `_meta["mcp/www_authenticate"]` for ChatGPT, which does not raise its link-account UI from a bare 401. Tools also advertise `securitySchemes` in their `_meta`.

Also removes the anonymous sign-in elicitation, which interrupted the turn to ask the user to run `ctx7 setup` in a terminal instead of driving the client's own OAuth flow.
