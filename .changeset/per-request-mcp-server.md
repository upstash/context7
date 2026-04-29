---
"@upstash/context7-mcp": patch
---

Create a fresh `McpServer` per HTTP request. Sharing one across requests let any concurrent `transport.close` clear the shared `Protocol._transport`, which broke `sendNotification` for in-flight long-running tool calls.
