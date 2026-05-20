---
"@upstash/context7-mcp": minor
---

Add multi-tenant Microsoft Entra ID validation for MCP tokens. The server now detects inbound Entra v2 tokens by issuer pattern, fetches per-teamspace configuration (`tenantId`, `audience`, `requiredScope`) from the Context7 app, and verifies the token against the matching tenant's JWKS. Returns the resolved user identity (`teamspaceId`, `oid`, `email`, `name`) on success so per-user request context can be set up downstream. Per-tenant JWKS cache and a 5-minute in-memory config cache keyed by JWT audience reduce overhead under load.
