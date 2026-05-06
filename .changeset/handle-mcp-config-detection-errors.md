---
"ctx7": patch
---

Handle malformed MCP config files gracefully during `ctx7 remove` agent detection. Previously, an unparseable JSON config at any agent's well-known path (e.g. a hand-edited `~/.claude.json`) would crash the command with an unhandled `SyntaxError` before it could do anything. The detector now skips the offending file and logs a warning naming the path and parse error so the user can fix it, while detection continues for the remaining agents.
