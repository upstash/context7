Use Context7 MCP to fetch current documentation before answering questions about libraries, frameworks, or APIs -- even well-known ones like React, Next.js, Prisma, Express, Tailwind, Django, or Spring Boot. Your training data may not reflect recent changes.

IMPORTANT: Use even when you think you know the answer. Verify against current docs.

Always use for: API syntax questions, configuration options, version migration issues, "how do I" questions mentioning a library name, debugging that involves library-specific behavior, setup instructions, and CLI tool usage.

When NOT to use: refactoring, writing scripts from scratch, debugging business logic, code review, general programming concepts the user already understands.

## Steps

1. `resolve-library-id` with the library name and the user's question
2. Pick the best match -- prefer exact names, use version-specific IDs when a version is mentioned
3. `query-docs` with the selected library ID and a descriptive query (use the user's full question, not single words)
4. Answer using the fetched docs

For details on authentication, version-specific IDs, and library resolution tips, see the `find-docs` skill if available.
