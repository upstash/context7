# Context7 Plugin for Claude Code

Context7 solves a common problem with AI coding assistants: outdated training data and hallucinated APIs. Instead of relying on stale knowledge, Context7 fetches current documentation directly from source repositories.

## What's Included

This plugin provides:

- **MCP Server** - Connects Claude Code to Context7's hosted MCP server (`https://mcp.context7.com/mcp`), with no local Node.js, npm, or npx required
- **Skills** - Auto-triggers documentation lookups when you ask about libraries
- **Agents** - A dedicated `docs-researcher` agent for focused lookups
- **Commands** - `/context7:docs` for manual documentation queries

## Installation

Add the marketplace and install the plugin:

```bash
claude plugin marketplace add upstash/context7
claude plugin install context7@context7-marketplace
```

## Authentication

After installing the plugin, restart Claude Code and run:

```
/mcp
```

Select Context7 and follow the browser sign-in flow. No API key is required.

## Data and Privacy

The plugin sends only the parameters of each tool call, such as the library name and the documentation question, to the Context7 MCP server, together with your Context7 OAuth token. It does not read or upload your files, and it does not run local commands or hooks. See the [Context7 privacy policy](https://context7.com/privacy) for how Context7 handles this data.

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

For manual lookups, use the command:

```
/context7:docs next.js app router
/context7:docs /vercel/next.js/v15.1.8 middleware
```

Or spawn the docs-researcher agent when you want to keep your main context clean:

```
spawn docs-researcher to look up Supabase auth methods
```

## Version Pinning

To get documentation for a specific version, include the version in the library ID:

```
/vercel/next.js/v15.1.8
/supabase/supabase/v2.45.0
```

The `resolve-library-id` tool returns available versions, so you can pick the one that matches your project.
