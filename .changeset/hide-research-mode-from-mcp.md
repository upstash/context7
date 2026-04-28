---
"@upstash/context7-mcp": patch
---

Remove the `researchMode` parameter from the `query-docs` tool's input schema. The underlying API still supports research mode, but several MCP clients hit per-request timeouts (60s defaults) on long-running research calls in ways that can't always be solved server-side. Hiding the parameter prevents agents from invoking it through MCP until the timeout story is reliable across clients.
