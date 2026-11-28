---
"ctx7": patch
---

Find the Codex `[mcp_servers.context7]` table only on a real header line, so a commented-out `# [mcp_servers.context7]` no longer makes `ctx7 setup` write a second table next to the live one or `ctx7 remove` delete the comment and leave the server configured
