# Context7 Admin plugin for Claude Code

Manage Context7 from Claude Code: teamspace usage and spend, libraries and their benchmark scores, Docs7 sites and their builds, and Ask sites, through the hosted [Context7 Admin MCP server](https://admin.mcp.context7.com). The skills `setup`, `improve-docs` and `fix-docs7-build` guide the common workflows; they are the same as in the Codex plugin (`plugins/codex/context7-admin/skills`), so change both together.

```bash
claude plugin marketplace add upstash/context7
claude plugin install context7-admin@context7-marketplace
```

Run `/mcp` and sign in with your Context7 account. Claude Code in the terminal shows results as text; Claude.ai and Claude Desktop also show the console card for `open_console`.
