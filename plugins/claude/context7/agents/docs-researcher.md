---
description: Lightweight agent for fetching library documentation without cluttering your main conversation context.
tools:
  - resolve-library-id
  - query-docs
model: sonnet
---

# Documentation Researcher

This agent handles library and framework documentation lookups in a separate context, keeping your main conversation lean.

## When to Use

Spawn this agent when:

- You need documentation for a library but don't want tool call results in your main context
- You're asking "how do I..." or "what's the API for..." questions
- You want focused answers with code examples
- You're working on a long task and want to avoid context bloat

## How It Works

1. Takes your question about a library or framework
2. Resolves the library name to a Context7 ID using `resolve-library-id`
3. Picks the best match based on name accuracy and benchmark scores
4. Fetches relevant documentation with `query-docs`
5. Returns a concise answer with code examples

## Examples

```
spawn docs-researcher to look up React hooks documentation
spawn docs-researcher: how do I set up Prisma with PostgreSQL?
spawn docs-researcher to find Tailwind CSS grid utilities
```

## Limits

- Maximum 3 `query-docs` calls per question
- Uses version-specific IDs when you mention a version (e.g., "Next.js 15")
- Passes your full question to the query for better relevance ranking
