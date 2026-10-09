# Context7 Plugin for Cursor

Context7 solves a common problem with AI coding assistants: outdated training data and hallucinated APIs. Instead of relying on stale knowledge, Context7 fetches current documentation directly from source repositories.

## Installation

Install from the Cursor Marketplace: open **Customize** in the Cursor sidebar, find **Context7**, select **Install**, and choose a project or user scope. The MCP server shows **Needs authentication** on first use; sign in with your Context7 account to finish the OAuth flow.

The plugin is published from this repository. The root `.cursor-plugin/marketplace.json` points Cursor at this folder, and the plugin manifest is `.cursor-plugin/plugin.json`.

## What's Included

This plugin provides:

- **MCP Server** (`mcp.json`) — Connects Cursor to Context7's documentation service over OAuth
- **Rules** (`rules/`) — An always-on `use-context7` rule that nudges the agent to fetch docs when unsure about library APIs
- **Skills** (`skills/`) — A `context7-mcp` skill with detailed instructions on resolving libraries and fetching documentation
- **Agents** (`agents/`) — A dedicated `docs-researcher` agent for focused lookups

```
plugins/cursor/context7/
├── .cursor-plugin/
│   └── plugin.json          # Plugin manifest
├── agents/
│   └── docs-researcher.md
├── assets/
│   └── logo.svg
├── rules/
│   └── use-context7.mdc
├── skills/
│   └── context7-mcp/
│       └── SKILL.md
├── mcp.json                 # MCP server definition
└── README.md
```

## Available Tools

### resolve-library-id

Searches for libraries and returns Context7-compatible identifiers.

```
Input: "next.js"
Output: { id: "/vercel/next.js", name: "Next.js", versions: ["v15.1.8", "v14.2.0", ...] }
```

### query-docs

Fetches documentation for a specific library, ranked by relevance to your question.

```
Input: { libraryId: "/vercel/next.js", query: "app router middleware" }
Output: Relevant documentation snippets with code examples
```

## Usage Examples

The plugin works automatically when you ask about libraries:

- "How do I set up authentication in Next.js 15?"
- "Show me React Server Components examples"
- "What's the Prisma syntax for relations?"

Or use the docs-researcher agent when you want to keep your main context clean.

## Version Pinning

To get documentation for a specific version, include the version in the library ID:

```
/vercel/next.js/v15.1.8
/supabase/supabase/v2.45.0
```

The `resolve-library-id` tool returns available versions, so you can pick the one that matches your project.

## Testing the Plugin Locally

Cursor loads unpublished plugins from `~/.cursor/plugins/local`. To try a change before it reaches the marketplace:

1. Copy this folder (not a symlink; Cursor skips symlinks that point outside the local plugins directory):

   ```bash
   rm -rf ~/.cursor/plugins/local/context7
   cp -R plugins/cursor/context7 ~/.cursor/plugins/local/context7
   ```

2. Restart Cursor, or run **Developer: Reload Window** from the command palette.
3. Open **Customize** and confirm the plugin lists the `context7` MCP server, the `use-context7` rule, the `context7-mcp` skill, and the `docs-researcher` agent.
4. When the MCP server shows **Needs authentication**, sign in, then ask the agent a library question and check that it calls `resolve-library-id` and `query-docs`.

If a marketplace copy of the plugin is already installed, it takes precedence over the local folder, so uninstall it first. On Teams and Enterprise plans an admin must enable **Allow Local Plugin Imports** under **Dashboard → Settings → Security & Identity → Marketplace and Plugins**.

The manifests are checked in CI against the schemas from [cursor/plugins](https://github.com/cursor/plugins/tree/main/schemas):

```bash
pnpm --filter ctx7 test -- plugin-manifests
```
