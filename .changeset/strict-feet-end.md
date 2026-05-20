---
"@upstash/context7-mcp": minor
---

Add stateful sessions to the HTTP transport.

The `--transport http` server now follows the MCP Streamable HTTP session model
instead of constructing a fresh transport per request:
