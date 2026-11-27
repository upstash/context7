---
"@upstash/context7-mcp": minor
---

While a library's source is being indexed, the code tools answer with an MCP task for clients that declare the Tasks extension (`io.modelcontextprotocol/tasks`). The client waits for the index and the agent gets the real result. The Context7 API keeps the task, so the server needs no new setup. Other clients get the same answer as before.
