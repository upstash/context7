---
"@upstash/context7-mcp": patch
---

Serve the dashboard's experimental tools choice without a lookup per request. With `MCP_EXPERIMENTAL_TOOLS_REDIS_REST_URL` and `MCP_EXPERIMENTAL_TOOLS_REDIS_REST_TOKEN` set, the HTTP server keeps every user's choice in memory, refreshed from Redis every 15 seconds. Without them it asks the Context7 API at most once per credential every five minutes (two minutes after a failure), with at most 32 lookups in flight.
