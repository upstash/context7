---
"@upstash/context7-mcp": patch
---

Answer an expired or revoked OAuth access token (`oat_…`) on the hosted HTTP transport with an HTTP 401 and a `WWW-Authenticate: Bearer error="invalid_token"` challenge, so MCP clients refresh the token instead of showing a tool error. The server checks the token against the Context7 API before serving the request, caches the verdict per token hash for about a minute, and fails open when the check is unavailable. Set `MCP_OAUTH_TOKEN_VALIDATION=off` to disable the check. When the Context7 API still rejects an OAuth token on a tool call, the tool text now says the sign-in expired instead of describing API keys.
