# Context7 Plugin for Codex

Context7 solves a common problem with AI coding assistants: outdated training data and hallucinated APIs. Instead of relying on stale knowledge, Context7 fetches current documentation directly from source repositories.

## Installation

Add the Context7 marketplace and install the plugin:

```bash
codex plugin marketplace add upstash/context7
codex plugin add context7@context7-marketplace
```

After adding the plugin, a browser window opens so you can log in to Context7 via OAuth. Start a new Codex thread after installation so Codex can load the plugin's skill and MCP tools.

## What's Included

This plugin provides:

- **MCP Server** - Connects Codex to Context7's documentation service
- **Skills** - Auto-triggers documentation lookups when you ask about libraries

## Authentication

The plugin connects to the hosted Context7 MCP server:

```json
{
  "type": "http",
  "url": "https://mcp.context7.com/mcp"
}
```

When you add the plugin, a browser window opens to log in to Context7 via OAuth, so your requests use your account's authenticated rate limits. On remote or headless machines where a browser can't open, run `npx ctx7 setup --codex` instead — it uses the OAuth device flow and writes an API-key-backed configuration to `~/.codex/config.toml`. Create or manage API keys in the [Context7 dashboard](https://context7.com/dashboard).

## Available Tools

### resolve-library-id

Searches for libraries and returns Context7-compatible identifiers.

```text
Input: "next.js"
Output: { id: "/vercel/next.js", name: "Next.js", versions: ["v15.1.8", "v14.2.0", ...] }
```

### query-docs

Fetches documentation for a specific library, ranked by relevance to your question.

```text
Input: { libraryId: "/vercel/next.js", query: "app router middleware" }
Output: Relevant documentation snippets with code examples
```

## Usage Examples

The bundled skill works automatically when you ask about libraries:

- "How do I set up authentication in Next.js 15?"
- "Show me React Server Components examples"
- "What's the Prisma syntax for relations?"

You can also invoke it explicitly:

```text
use context7 for Next.js middleware docs
use context7 for Prisma query examples with relations
use context7 for the Supabase syntax for row-level security
```

To get documentation for a specific version, include the version in the library ID:

```text
/vercel/next.js/v15.1.8
/supabase/supabase/v2.45.0
```
