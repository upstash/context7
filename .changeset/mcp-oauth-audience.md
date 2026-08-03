---
"@upstash/context7-mcp": patch
---

Validate the audience on Clerk-issued JWTs and stop accepting arbitrary bearer strings on the OAuth-protected endpoint. The Clerk verification path checked only issuer and signature, so any JWT that instance signed for any purpose verified against this server; the MCP spec requires a resource server to accept only tokens issued for itself. Separately, `/mcp/oauth` returned 401 without a credential but let through any value that did not parse as a JWT, opening a session for a credential that could not be valid.
