---
"@upstash/context7-mcp": patch
---

Require credentials on the hosted HTTP `/mcp` endpoint, keep `/mcp/oauth` as a compatibility alias, publish endpoint-specific OAuth metadata, and emit privacy-safe authentication migration events. Operators can use `MCP_AUTH_ENFORCEMENT=observe` to measure missing credentials before enforcing the migration.
