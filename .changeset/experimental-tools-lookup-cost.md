---
"@upstash/context7-mcp": patch
---

Read the experimental tools choice only for requests that list tools or call an experimental tool, and keep it for five minutes, so signed-in requests no longer each call the Context7 API. `MCP_EXPERIMENTAL_TOOLS_LOOKUP=off` turns the lookup off.

With `MCP_EXPERIMENTAL_TOOLS_REDIS_REST_URL` and `MCP_EXPERIMENTAL_TOOLS_REDIS_REST_TOKEN` set, the HTTP server keeps every user's choice in memory, refreshed from Redis every 15 seconds, and signed-in requests make no lookup at all.
