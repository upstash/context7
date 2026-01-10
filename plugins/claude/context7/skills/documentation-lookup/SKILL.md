---
description: Automatically fetches library documentation when you ask about frameworks, APIs, or code patterns.
triggers:
  - library questions
  - framework setup
  - API references
  - code examples
---

# Documentation Lookup

This skill activates when you ask questions about libraries, frameworks, or need code examples. It fetches current documentation from source repositories instead of relying on training data.

## When It Triggers

The skill runs automatically when you:

- Ask setup questions ("How do I configure Next.js middleware?")
- Request code generation involving libraries ("Write a Prisma query for...")
- Need API references ("What are the Supabase auth methods?")
- Mention specific frameworks (React, Vue, Svelte, Express, Tailwind, etc.)

## Process

1. **Resolve**: Finds the library ID using `resolve-library-id` with your question as context
2. **Select**: Picks the best match based on exact name matching and quality scores
3. **Fetch**: Calls `query-docs` with the library ID and your specific question
4. **Return**: Provides code examples and explanations from current documentation

## Guidelines

- Uses your full question as the query parameter for better relevance
- Limited to 3 documentation calls per question to avoid overwhelming context
- Picks version-specific IDs when you mention versions ("Next.js 15", "React 19")
- Checks available versions from the resolution step before querying

## Supported Libraries

Works with any library indexed by Context7, including:

- Frontend: React, Next.js, Vue, Nuxt, Svelte, SvelteKit, Solid, Astro
- Backend: Express, Fastify, Hono, NestJS, Django, FastAPI, Rails
- Databases: Prisma, Drizzle, Supabase, Firebase, MongoDB
- Styling: Tailwind CSS, Styled Components, Emotion
- And thousands more...

## Example Interactions

**You**: "How do I set up authentication with Supabase?"

**Skill activates**:
1. Resolves "supabase" → `/supabase/supabase`
2. Queries with "authentication setup"
3. Returns current auth documentation with code examples

**You**: "Show me React 19 use() hook examples"

**Skill activates**:
1. Resolves "react" with version context → `/facebook/react/v19.0.0`
2. Queries with "use hook examples"
3. Returns React 19-specific documentation
