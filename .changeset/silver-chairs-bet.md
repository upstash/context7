---
"@upstash/context7-mcp": patch
---

Use stateless pattern for HTTP transport to prevent connection leaks. Creates a new McpServer instance per HTTP request instead of sharing a single global instance.
