---
"@upstash/context7-mcp": patch
---

Advertise empty `prompts` and `resources` capabilities with no-op `prompts/list` and `resources/list` handlers. Some MCP clients (e.g. opencode) call these unconditionally and treat `-32601 Method not found` as a fatal connection error rather than honoring the negotiated capabilities, which previously prevented the server from loading.
