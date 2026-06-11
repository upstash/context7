# Context7 Plugin for GitHub Copilot CLI

Context7 solves a common problem with AI coding assistants: outdated training data and hallucinated APIs. Instead of relying on stale knowledge, Context7 fetches current documentation directly from source repositories.

## What's Included

This plugin provides:

- **MCP Server** - Connects Copilot CLI to Context7's documentation service
- **Skills** - Auto-triggers documentation lookups when you ask about libraries
- **Agents** - A dedicated `docs-researcher` agent for focused lookups
- **Commands** - `/context7:docs` for manual documentation queries

## Installation

Add the marketplace and install the plugin:

```bash
copilot plugin marketplace add upstash/context7
copilot plugin install context7@context7-marketplace
```

## API Key (Recommended)

Without an API key, the plugin connects anonymously and shares the anonymous rate limits. To use your own plan, create an API key in the [Context7 dashboard](https://context7.com/dashboard) and export it as an environment variable before launching Copilot CLI:

```bash
# e.g. in ~/.zshrc or ~/.bashrc
export CONTEXT7_API_KEY="your-api-key"
```

The plugin's MCP server configuration picks up `CONTEXT7_API_KEY` automatically. Restart Copilot CLI after setting it, then verify the key is being used by checking your usage in the [dashboard](https://context7.com/dashboard).

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

Or use the docs-researcher agent when you want to keep your main context clean:

```bash
copilot --agent docs-researcher -p "look up Supabase auth methods"
```

## Version Pinning

To get documentation for a specific version, include the version in the library ID:

```
/vercel/next.js/v15.1.8
/supabase/supabase/v2.45.0
```

The `resolve-library-id` tool returns available versions, so you can pick the one that matches your project.
