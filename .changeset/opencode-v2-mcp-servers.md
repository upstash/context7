---
"ctx7": patch
---

Write the OpenCode MCP entry inside `mcp.servers` when the config already uses the OpenCode 2.x layout, without the 1.x `enabled` field. `ctx7 setup` also moves an entry that an earlier version wrote next to `mcp.servers`. Other configs keep the 1.x layout, which OpenCode 1.x and 2.x both read. `ctx7 remove` finds Context7 in either layout.
