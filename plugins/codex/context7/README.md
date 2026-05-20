# Context7 Plugin for OpenAI Codex

Context7 grounds Codex in real documentation. Instead of relying on stale training data, it fetches version-specific docs and code examples directly from source repositories.

## What's Included

- **MCP server** for the Context7 documentation service (`resolve-library-id`, `query-docs`)
- **Skill** that auto-triggers documentation lookups when you ask about libraries, frameworks, SDKs, or APIs

The skill body is generated from the canonical rule at [`rules/context7-mcp.md`](../../../rules/context7-mcp.md). The `sync-plugins` GitHub Action regenerates and commits this file whenever the source rule changes. To regenerate locally, run `pnpm sync:plugins` from the repo root.

## Installation

Add the marketplace and install the plugin:

```bash
codex plugin marketplace add upstash/context7
codex plugin install context7@context7-marketplace
```

## Authentication (optional)

Most usage works without an API key. For higher rate limits, set:

```bash
export CONTEXT7_API_KEY=your_key
```

You can get a key at https://context7.com.

## Usage

The skill activates automatically when you ask about any library or framework, for example:

- "How do I set up authentication in Next.js 15?"
- "Show me React Server Components examples"
- "What's the Prisma syntax for relations?"

For version-specific docs, mention the version or pass a version-pinned library ID:

```
/vercel/next.js/v15.1.8
/facebook/react/v19.0.0
```
