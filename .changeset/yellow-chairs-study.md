---
"@upstash/context7-mcp": minor
---

Add OAuth 2.0 authentication support for MCP server

- Add new `/mcp/oauth` endpoint requiring JWT authentication
- Implement JWT validation against authorization server JWKS
- Add OAuth Protected Resource Metadata endpoint (RFC 9728) at `/.well-known/oauth-protected-resource`
- Include `WWW-Authenticate` header for OAuth discovery
