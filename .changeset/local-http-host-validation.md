---
"@upstash/context7-mcp": patch
---

Bind the HTTP transport to `127.0.0.1` by default and reject requests with a non-loopback `Host` or `Origin` header on a loopback bind. Pass `--host 0.0.0.0` to accept connections from other machines.
