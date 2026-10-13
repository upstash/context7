---
"@upstash/context7-mcp": minor
---

Add a `foreign` mode to the OAuth audience check on the hosted HTTP transport. `MCP_OAUTH_AUDIENCE_ENFORCEMENT=foreign` answers HTTP 401 (`WWW-Authenticate: Bearer error="invalid_token"`, "This token was issued for another server. If you connect through a gateway or proxy, use a Context7 API key instead.") to a Clerk OAuth JWT whose `aud` names another server, and still admits a token with no `aud`, which grants authorized before Clerk's "Include Audience" setting carry on every refresh. `observe` (the default) and `required` are unchanged. The query string of an audience on an allowed host is ignored, since Cursor writes the configured MCP URL (`https://mcp.context7.com/mcp?client=codex`) into `resource`; on any other host it is kept. The `audienceMismatch` log line now carries `outcome=accepted|rejected` and is written at most once per token per hour instead of every ten minutes.
