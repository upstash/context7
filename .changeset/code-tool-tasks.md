---
"@upstash/context7-mcp": minor
---

While a library's source is being indexed, the code tools answer with an MCP task for clients that declare the Tasks extension (`io.modelcontextprotocol/tasks`). The client waits for the index and the agent gets the real result. Other clients get the same answer as before. The HTTP server keeps tasks in the Upstash Redis database of `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`, and creates no tasks without it.
