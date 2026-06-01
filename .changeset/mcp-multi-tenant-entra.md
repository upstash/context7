---
"@upstash/context7-mcp": minor
---

Add multi-tenant Microsoft Entra ID validation for MCP tokens. The server now detects inbound Entra v2 tokens by issuer pattern, fetches per-teamspace configuration (`tenantId`, `audience`, `requiredScope`) from the Context7 app, and verifies the token against the matching tenant's JWKS, enforcing the required scope claim when configured. User resolution happens downstream in the Context7 app against a pre-provisioned user mapping table — the MCP server only validates. Per-tenant JWKS cache and a 5-minute in-memory config cache keyed by JWT audience reduce overhead under load.
