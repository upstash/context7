---
"@upstash/context7-mcp": patch
---

Serve the dashboard's experimental tools choice without a lookup per request. The hosted HTTP server (with `MCP_CLIENT_IP_ASSERTION_KEY`) keeps every user's choice in memory, refreshed from the Context7 app's snapshot endpoint every 15 seconds. Other servers ask the Context7 API at most once per credential every five minutes (two minutes after a failure), with at most 32 lookups in flight.
