---
"@upstash/context7-mcp": patch
---

Stage credential enforcement on the hosted HTTP `/mcp` endpoint with `MCP_AUTH_ENFORCEMENT`. The default `observe` mode keeps anonymous `/mcp` access and records privacy-safe authentication migration events, while `/mcp/oauth` and Claude Code plugin requests keep their existing challenge. Set `required` to reject requests without credentials. `/mcp/oauth` stays as a compatibility alias, and each endpoint publishes its own OAuth protected-resource metadata.
