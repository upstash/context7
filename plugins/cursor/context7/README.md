# Context7 Plugin for Cursor

Context7 solves a common problem with AI coding agents: outdated training data and hallucinated APIs. Instead of relying on stale knowledge, Context7 fetches current documentation directly from source repositories.

## What's Included

This plugin provides:

- **MCP Server** — Connects Cursor to Context7's documentation service over OAuth (`https://mcp.context7.com/mcp/oauth`)
- **Rules** — An always-on `use-context7` rule that nudges the agent to fetch docs when unsure about library APIs
- **Skills** — A `context7-mcp` skill with detailed instructions on resolving libraries and fetching documentation
- **Agents** — A dedicated `docs-researcher` agent for focused lookups

## Installation

### From the Cursor Marketplace

1. Open **Customize** in the Cursor sidebar and search for **Context7**, or open the listing at [cursor.com/marketplace](https://cursor.com/marketplace).
2. Select **Install** and choose a user or project scope.
3. When the `context7` MCP server shows **Needs authentication**, click it and complete the sign-in in your browser.

Or run `/add-plugin context7` in chat.

After installation, **Customize** lists the `context7` MCP server, the `use-context7` rule, the `context7-mcp` skill, and the `docs-researcher` agent.

### Locally, for development

Cursor loads plugins from `~/.cursor/plugins/local`. Copy this directory there (symlinks that point outside the folder are ignored):

```bash
mkdir -p ~/.cursor/plugins/local/context7
cp -R plugins/cursor/context7/. ~/.cursor/plugins/local/context7
```

Then restart Cursor or run **Developer: Reload Window** and check **Customize** for the plugin's components.

If the marketplace plugin with the same name is already installed, that install takes precedence over the local copy. Uninstall it first to test local changes.

On Teams and Enterprise plans, admins control this with **Allow Local Plugin Imports** under **Dashboard → Settings → Security & Identity → Marketplace and Plugins** (off by default on Enterprise).

## Available Tools

### resolve-library-id

Searches for libraries and returns Context7-compatible identifiers.

```
Input: "next.js"
Output: { id: "/vercel/next.js", name: "Next.js", versions: ["v16.2.9", "v15.1.8", ...] }
```

### query-docs

Fetches documentation for a specific library, ranked by relevance to your question.

```
Input: { libraryId: "/vercel/next.js", query: "app router proxy" }
Output: Relevant documentation snippets with code examples
```

## Usage Examples

The plugin works automatically when you ask about libraries:

- "How do I set up authentication in Next.js 16?"
- "Show me React Server Components examples"
- "What's the Prisma syntax for relations?"

Or use the docs-researcher agent when you want to keep your main context clean.

## Version Pinning

To get documentation for a specific version, include the version in the library ID:

```
/vercel/next.js/v16.2.9
/supabase/supabase/v2.45.0
```

The `resolve-library-id` tool returns available versions, so you can pick the one that matches your project.

## Plugin Layout

```
plugins/cursor/context7/
├── .cursor-plugin/
│   └── plugin.json          # Cursor plugin manifest
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
├── LICENSE
└── README.md
```

The repository root carries `.cursor-plugin/marketplace.json`, which lists this plugin for the Cursor Marketplace.
