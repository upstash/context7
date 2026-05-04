---
"ctx7": patch
"@upstash/context7-mcp": patch
---

Remove research mode entirely from the MCP server and CLI. The `query-docs` MCP tool no longer accepts or forwards a `researchMode` parameter, and the CLI no longer exposes a `--research` flag on `ctx7 docs`.
