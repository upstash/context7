---
"ctx7": patch
---

`ctx7 setup` now properly supports `--antigravity`, installing skills, rules, and MCP config to Antigravity's expected locations (`.agent/skills`, `~/.gemini/antigravity/mcp_config.json` with `serverUrl` for HTTP). Also removes the `--universal` flag from `setup`, which was advertised but silently ignored — it never propagated through agent selection, so passing it (e.g. `setup --cli --universal --project`) caused setup to fall back to auto-detection and write to the wrong directory.
