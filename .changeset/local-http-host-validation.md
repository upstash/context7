---
"@upstash/context7-mcp": patch
---

Bind the HTTP transport to `127.0.0.1` by default. When the bind host is `127.0.0.1`, `localhost` or `::1`, reject requests with a non-loopback `Host` or `Origin` header. Pass `--host 0.0.0.0` (or set `CONTEXT7_MCP_HOST`) to accept connections from other machines.
