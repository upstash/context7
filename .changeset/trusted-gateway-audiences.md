---
"@upstash/context7-mcp": patch
---

The hosted server accepts an OAuth token issued for a teamspace's trusted MCP gateway. Before it rejects a Clerk JWT whose audience is another server, it asks the Context7 API whether that audience is a registered gateway, and lets such a token through for the API to check against the user's teamspace. A token the API refuses as issued for another server now gets that message instead of "expired", so MCP clients do not sign in again in a loop.
