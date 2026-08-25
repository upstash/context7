---
"@upstash/context7-mcp": patch
---

Consume request/cancellation pairs contained in the same JSON-RPC batch before dispatch. This prevents the legacy stateless HTTP transport from leaving the response stream open when cancellation suppresses the terminal protocol response.
