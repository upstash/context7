---
"@upstash/context7-mcp": minor
---

Support Enterprise-Managed Auth for Claude's connectors. Protected resource metadata now lists the Context7 EMA authorization server first when Claude's hosted connectors ask (Anthropic's egress range, `EMA_DISCOVERY_CIDRS`), so the existing `/mcp` connector can run the id-jag exchange; other clients keep Clerk first. A new `/mcp/ema` endpoint always requires authentication and lists only the EMA authorization server.
