---
name: context7-mcp
description: Fetches current, version-specific library documentation and code examples through the Context7 MCP server. Use whenever the user asks about a library, framework, SDK, API, CLI tool, or cloud service, including API syntax, configuration, setup instructions, version migration, porting code between libraries, platforms, or SQL dialects, CLI usage, and library-specific debugging. Use when generating code that calls a third-party library, and when the user names a version such as Next.js 16 or React 19. Use even for well-known libraries like React, Vue, Next.js, Prisma, Supabase, Express, Tailwind, Django, and Spring Boot, because training data may not reflect recent changes. Prefer this over web search for library documentation. Do not use it for refactoring, debugging, or reviewing code that does not depend on a library or platform API, for general programming concepts, or when the user has already supplied the relevant documentation.
---

When the user asks about libraries, frameworks, or needs code examples, use Context7 to fetch current documentation instead of relying on training data.

## When to Use This Skill

Activate this skill when the user:

- Asks setup or configuration questions ("How do I configure a Next.js proxy?")
- Requests code involving libraries ("Write a Prisma query for...")
- Needs API references ("What are the Supabase auth methods?")
- Needs an exact fact from a library's source: a default value, a signature, or where an error comes from
- Mentions specific frameworks (React, Vue, Svelte, Express, Tailwind, etc.)

## How to Fetch Documentation

### Step 1: Resolve the Library ID

Call `resolve-library-id` with:

- `libraryName`: The library name extracted from the user's question
- `query`: What to look up in the library's documentation (improves relevance ranking)

### Step 2: Select the Best Match

From the resolution results, choose based on:

- Exact or closest name match to what the user asked for
- Higher benchmark scores indicate better documentation quality
- If the user mentioned a version (e.g., "React 19") or the project pins one, keep it for `version` in Step 3

### Step 3: Fetch the Documentation

Call `query-docs` with:

- `libraryId`: The selected Context7 library ID (e.g., `/vercel/next.js`)
- `query`: What to look up in the library's documentation, scoped to a single concept
- `version` (optional): The version the user's project uses or the question names, as written there (e.g., `15.4.3`, `^15.4.3`, `14`). Pass it here, not as a suffix of the library ID

If the user's question spans multiple distinct concepts (e.g. routing and auth and caching), make a separate `query-docs` call per concept with the same library ID, unless the question is about how the concepts interact. Combined queries dilute ranking and return shallow results for each topic.

### Step 4: Read the Source When Docs Are Not Exact

If the `query-code` tool is available, use it for exact facts the docs may not state: a signature or type, a default value, an option name, where an error message comes from, or how something works inside.

- `libraryId`: an ID that `resolve-library-id` marks with "Source code", usually the GitHub repository (e.g. `/colinhacks/zod`). `/websites/...` and `/llmstxt/...` IDs have no source
- Start with `grep` (`fixed_strings: true` for error messages) or `definition` for a symbol, then `read` the file range the result gives. `references`, `outline` and `list` also exist
- Follow the result's "Next:" line for the read, page or count call to make next. Most questions need 1 to 4 calls; stop at 6
- `version` takes a git tag, e.g. `v3.24.2`. A tag that is not a docs version is indexed first ("being indexed"). If indexing fails, the answer lists the docs versions you can use
- If it answers "being indexed", call again every 30 seconds for up to 3 minutes (a first index usually takes 1 to 3), then answer from `query-docs`. These calls do not count toward the 6
- Cite the file and line of the source you used

### Step 5: Use the Documentation

Incorporate the fetched documentation into your response:

- Answer the user's question using current, accurate information
- Include relevant code examples from the docs
- Cite the library version when relevant

## Guidelines

- **Be specific**: Describe what to look up in the library's documentation, but keep each query to a single concept
- **One topic per query**: Split multi-topic questions into separate `query-docs` calls. Resolve the library ID once, then query per concept, unless the question is about how the concepts interact
- **Version awareness**: When users mention versions ("Next.js 16", "React 19") or the project pins one, pass it as `version` to `query-docs`; Context7 serves that version or the closest one it has
- **Prefer official sources**: When multiple matches exist, prefer official/primary packages over community forks
