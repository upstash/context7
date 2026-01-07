# Context7 Plugins

This folder contains official plugins for AI coding assistants. Plugins bundle MCP server configurations with skills, agents, and commands specific to each platform.

## Available Plugins

### Claude Code

Located at `claude/context7/`:

- **MCP Server** - Connects to Context7's documentation API
- **Skills** - Auto-triggers documentation lookups
- **Agents** - `docs-researcher` for focused lookups
- **Commands** - `/context7:docs` for manual queries

See [claude/context7/README.md](claude/context7/README.md) for installation and usage.

## Plugin Structure

Each plugin follows this structure:

```
<platform>/<plugin-name>/
  .claude-plugin/
    plugin.json       # Plugin metadata
  .mcp.json           # MCP server configuration
  README.md           # Documentation
  agents/             # Agent definitions (optional)
  commands/           # Command definitions (optional)
  skills/             # Skill definitions (optional)
```

## Adding Plugins

To add a plugin to your coding assistant, copy the plugin folder to your assistant's plugins directory or use the assistant's plugin installation command.

For Claude Code:

```bash
claude plugins install context7
```

Or manually copy the folder to your Claude Code plugins directory.
