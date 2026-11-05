---
"ctx7": minor
---

Add Pi to `ctx7 setup` and `ctx7 remove`. `ctx7 setup --pi` writes the Context7 MCP server to `~/.pi/agent/mcp.json` (or `.pi/mcp.json` with `--project`) with `direct` tool exposure. It also adds the Context7 rule to Pi's context file and installs the skill in `~/.agents/skills`. Pi reads one context file per folder, so setup adds the rule to an existing `AGENTS.override.md` or `CLAUDE.md` instead of creating an `AGENTS.md` that would hide it. Setup honors `PI_CODING_AGENT_DIR`, and with `--oauth` it prints the `pi mcp login context7` step.
