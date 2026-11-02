---
"ctx7": patch
---

Write the OpenCode 2.x MCP entry under `mcp.servers` and drop the 1.x `enabled` field. `ctx7 setup` moves an entry that an earlier version wrote to `mcp.context7`, and `ctx7 remove` finds Context7 in either layout.
