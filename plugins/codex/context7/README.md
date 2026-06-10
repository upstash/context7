# Context7 Plugin for Codex

Context7 solves a common problem with AI coding assistants: outdated training data and hallucinated APIs. Instead of relying on stale knowledge, Context7 fetches current documentation directly from source repositories.

## Installation

Add the Context7 marketplace and install the plugin:

```bash
codex plugin marketplace add upstash/context7
codex plugin add context7@context7-marketplace
```

Start a new Codex thread after installation so Codex can load the plugin's skill and MCP tools.

## What's Included

This plugin provides:

- **MCP Server** - Connects Codex to Context7's documentation service
- **Skills** - Auto-triggers documentation lookups when you ask about libraries

## Authentication

The plugin starts the Context7 MCP package without an `--api-key` argument:

```json
{
  "cwd": ".",
  "command": "npx",
  "args": ["-y", "@upstash/context7-mcp"]
}
```

That is intentional. The MCP server reads `CONTEXT7_API_KEY` from its environment when the variable is present. If `CONTEXT7_API_KEY` is missing, the server starts anonymously and Context7 still works with anonymous limits.

To use authenticated limits, start Codex with `CONTEXT7_API_KEY` available in the Codex process environment. The MCP package also supports `--api-key`, but this plugin keeps the default env-var-or-anonymous behavior so a missing key never prevents startup.

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
