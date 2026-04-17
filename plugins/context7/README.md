# Context7 Plugin

Shared plugin source for Claude Code and GitHub Copilot CLI.

This directory keeps the plugin payload in one place:

- `commands/` for `/context7:docs`
- `skills/` for `context7-mcp`
- `agents/` for `docs-researcher`
- `.mcp.json` for the bundled Context7 MCP server

Each client has its own manifest:

- `plugin.json` for GitHub Copilot CLI
- `.claude-plugin/plugin.json` for Claude Code
