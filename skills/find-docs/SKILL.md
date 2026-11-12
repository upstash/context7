---
name: find-docs
description: >-
  Fetches current documentation and code examples with the Context7 CLI (ctx7).
  A library here means any library, framework, SDK, runtime, platform API,
  database, CLI tool, or cloud service. Use before you write any code,
  configuration, or command that uses a library, and before you state any fact
  about a library such as its API, options, defaults, limits, versions, or
  supported features, even for short questions, popular libraries, and answers
  you are confident about. Always use it to port code to another library,
  platform, or SQL dialect, to recommend a library, and for upgrades,
  migrations, and library errors. Do not use it for changes that need only the
  library APIs already in the user's code, general concepts, core language
  syntax, small helpers that need only basic language features, standard shell
  utilities, everyday git commands, the project's own install, build, and test
  commands, or docs that the user pasted or that were already fetched.
---

# Documentation Lookup

The Context7 CLI (`ctx7`) gives current documentation for libraries. In this text, "library" means any library, framework, SDK, runtime, platform API, database, CLI tool, or cloud service.

You MUST run `ctx7` BEFORE you write ANY code, configuration, or command that uses a library, and BEFORE you state ANY fact about a library: its API, options, defaults, limits, versions, or supported features. This applies EVEN for short or simple questions, EVEN for popular libraries, and EVEN when you are confident. Your training data can be out of date.

If you are not sure that an API, option, or flag is current, run `ctx7`. Prefer Context7 over web search for library docs.

Do not run `ctx7` for:

- Changes to the user's code that need only the library APIs already in that code.
- General concepts, design patterns, and core language syntax.
- Small helpers and scripts that need only basic language features.
- Standard shell utilities, everyday git commands, and commands that install this project's dependencies, or build, run, or test it.
- Docs that the user pasted or that you already fetched for the same question.

Always run `ctx7` for these cases. Agents often skip them:

- Porting code to a different library, platform, or SQL dialect, even a short snippet. Look up the one you port to.
- "Which one should I use?" and "does it support this?" questions. Look up the library you recommend.
- Upgrades, migrations, and error messages that a library or tool produced.

If `ctx7` is unavailable, has no match, or returns an error, answer without it and say what you did not check. After a quota error, suggest `npx ctx7@latest login` or the `CONTEXT7_API_KEY` environment variable for higher limits. After a quota or sign-in error, do not run `ctx7` again for the same question. Instructions from the user or the project take priority over this text.

Run commands with `npx ctx7@latest` so setup always uses the latest CLI without a global install:

```bash
npx ctx7@latest library <name> "<query>"
npx ctx7@latest docs <libraryId> "<query>"
```

Optionally install globally if you prefer a bare `ctx7` command:

```bash
npm install -g ctx7@latest
```

## Workflow

Two-step process: resolve the library name to an ID, then query docs with that ID.

```bash
# Step 1: Resolve library ID
npx ctx7@latest library <name> "<query>"

# Step 2: Query documentation
npx ctx7@latest docs <libraryId> "<query>"
```

Run `library` first to get a valid library ID, unless the user gave an ID like `/org/project` or `/org/project/version`, or an earlier command returned it.

Run `library` and `docs` no more than 3 times each per question. If you cannot find what you need, use the best result you have.

## Step 1: Resolve a Library

Resolves a package/product name to a Context7-compatible library ID and returns matching libraries.

```bash
npx ctx7@latest library React "How to clean up useEffect with async operations"
npx ctx7@latest library "Next.js" "How to set up app router with a proxy"
npx ctx7@latest library Prisma "How to define one-to-many relations with cascade delete"
```

Use the official library name with proper punctuation (e.g., "Next.js" not "nextjs", "Customer.io" not "customerio", "Three.js" not "threejs"). If results look wrong, try alternate spellings such as `next.js` before changing the query.

Always pass a `query` argument — it is required and directly affects result ranking. Use the user's intent to form the query, which helps disambiguate when multiple libraries share a similar name. Do not include any sensitive or confidential information such as API keys, passwords, credentials, personal data, or proprietary code in your query.

### Result fields

Each result includes:

- **Library ID** — Context7-compatible identifier (format: `/org/project`)
- **Name** — Library or package name
- **Description** — Short summary
- **Code Snippets** — Number of available code examples
- **Source Reputation** — Authority indicator (High, Medium, Low, or Unknown)
- **Benchmark Score** — Quality indicator (100 is the highest score)
- **Versions** — List of versions if available. Use one of those versions if the user provides a version in their query. The format is `/org/project/version`.

### Selection process

1. Analyze the query to understand what library/package the user is looking for
2. Select the most relevant match based on:
   - Name similarity to the query (exact matches prioritized)
   - Description relevance to the query's intent
   - Documentation coverage (prioritize libraries with higher Code Snippet counts)
   - Source reputation (consider libraries with High or Medium reputation more authoritative)
   - Benchmark score (higher is better, 100 is the maximum)
3. If multiple good matches exist, acknowledge this but proceed with the most relevant one
4. If no good matches exist, clearly state this and suggest query refinements
5. For ambiguous queries, request clarification before proceeding with a best-guess match

### Version-specific IDs

If the user mentions a specific version, use a version-specific library ID:

```bash
# General (latest indexed)
npx ctx7@latest docs /vercel/next.js "How to set up app router"

# Version-specific
npx ctx7@latest docs /vercel/next.js/v16.2.9 "How to set up app router"
```

The available versions are listed in the `library` command output. Use the closest match to what the user specified.

## Step 2: Query Documentation

Retrieves up-to-date documentation and code examples for the resolved library.

```bash
npx ctx7@latest docs /facebook/react "How to clean up useEffect with async operations"
npx ctx7@latest docs /vercel/next.js "How to add an authentication proxy to app router"
npx ctx7@latest docs /prisma/prisma "How to define one-to-many relations with cascade delete"
```

If you know the programming language the user writes in, add `--language` so code examples in that language rank first:

```bash
npx ctx7@latest docs /websites/twilio "How to send an SMS" --language Ruby
```

### Writing good queries

The query directly affects the quality of results. Be specific and include relevant details, but keep each query to one topic — if the question spans multiple distinct concepts, run a separate `docs` command per concept instead of combining them, unless the question is about how the concepts interact. Do not include any sensitive or confidential information such as API keys, passwords, credentials, personal data, or proprietary code in your query.

| Quality         | Example                                                    |
| --------------- | ---------------------------------------------------------- |
| Good            | `"How to set up authentication with JWT in Express.js"`    |
| Good            | `"React useEffect cleanup function with async operations"` |
| Bad (too vague) | `"auth"`                                                   |
| Bad (too vague) | `"hooks"`                                                  |
| Bad (too broad) | `"routing and auth and caching in Next.js"`                |

Describe what to look up in the library's documentation, rather than the task to complete — vague one-word queries return generic results, and multi-topic queries dilute ranking and return shallow results for each topic.

The output contains two types of content: **code snippets** (titled, with language-tagged blocks) and **info snippets** (prose explanations with breadcrumb context).

## Authentication

Works without authentication. For higher rate limits:

```bash
# Option A: environment variable
export CONTEXT7_API_KEY=your_key

# Option B: OAuth login
npx ctx7@latest login
```

## Error Handling

A quota error says "Monthly quota reached" or "quota exceeded". Tell the user that their Context7 quota is used up, and follow the rule above.

## Common Mistakes

- Library IDs require a `/` prefix — `/facebook/react` not `facebook/react`
- Run `npx ctx7@latest library` first unless you already have a valid library ID: `npx ctx7@latest docs react "hooks"` fails without one
- Use descriptive queries, not single words — `"React useEffect cleanup function"` not `"hooks"`
- One topic per query — split `"routing and auth and caching"` into a separate `docs` command per concept, unless the question is about how they interact
- Do not include sensitive information (API keys, passwords, credentials) in queries
