# Setup

## ctx7 setup

One-time command to configure Context7 MCP for your AI coding agent. Writes the MCP server config, a Context7 rule file, and a `documentation-lookup` skill.

```bash
ctx7 setup                     # Interactive — prompts for agent selection
ctx7 setup --claude            # Claude Code only
ctx7 setup --cursor            # Cursor only
ctx7 setup --opencode          # OpenCode only
ctx7 setup --project           # Configure current project instead of globally
ctx7 setup --yes               # Skip confirmation prompts
```

**Authentication options:**
```bash
ctx7 setup --api-key YOUR_KEY  # Use an existing API key
ctx7 setup --oauth             # OAuth endpoint (IDE handles the auth flow)
```

Without `--api-key` or `--oauth`, setup opens a browser for OAuth login and generates a new API key automatically.

**What gets written:**
- MCP server entry in the agent's config file (`.mcp.json` for Claude, `.cursor/mcp.json` for Cursor, `.opencode.json` for OpenCode)
- A Context7 rule file instructing the agent to use Context7 for library docs
- A `documentation-lookup` skill in the agent's skills directory
