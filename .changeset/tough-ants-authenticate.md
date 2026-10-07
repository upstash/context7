---
"@upstash/context7-mcp": minor
---

Require credentials on the HTTP `/mcp` endpoint by default. Set `MCP_AUTH_ENFORCEMENT=observe` to keep anonymous `/mcp` access and record privacy-safe authentication migration events; `/mcp/oauth` and Claude Code plugin requests keep their challenge in both modes. `/mcp/oauth` stays as a compatibility alias, each endpoint publishes its own OAuth protected-resource metadata, an empty or scheme-only `Authorization: Bearer` header counts as a missing credential, and CORS responses expose `WWW-Authenticate` and `MCP-Session-Id`.
