Use the `ctx7` CLI to fetch current documentation before answering questions about libraries, frameworks, or APIs -- even well-known ones like React, Next.js, or Prisma. Your training data may not reflect recent changes.

IMPORTANT: Use even when you think you know the answer. Verify against current docs.

When to use: API syntax, configuration, version migration, "how do I" with a library name, library-specific debugging, setup instructions, CLI tool usage.

When NOT to use: refactoring, writing scripts from scratch, debugging business logic, code review, general programming concepts the user already understands.

## Steps

1. Resolve library: `ctx7 library <name> "<user's question>"`
2. Pick the best match from results
3. Fetch docs: `ctx7 docs <libraryId> "<user's question>"`
4. Answer using the fetched documentation

Use descriptive queries (the user's full question), not single words. Do not run more than 3 commands per question.
