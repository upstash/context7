---
"ctx7": patch
---

`ctx7 setup` now properly supports `--antigravity`, installing skills to `.agent/skills`, a `GEMINI.md` rule section (Antigravity reads Gemini-family config), and MCP config to Antigravity 2.0's documented global path `~/.gemini/config/mcp_config.json` (with `httpUrl` for HTTP, matching the Gemini convention). Antigravity has no documented project-level MCP file, so `setup --antigravity --project --mcp` writes to the global location. Also removes the `--universal` flag from `setup`, which was advertised but silently ignored — it never propagated through agent selection, so passing it (e.g. `setup --cli --universal --project`) caused setup to fall back to auto-detection and write to the wrong directory.
