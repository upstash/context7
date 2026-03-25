Use the `ctx7` CLI to fetch current documentation before answering questions about libraries, frameworks, or APIs -- even well-known ones like React, Next.js, Prisma, Express, Tailwind, Django, or Spring Boot. Your training data may not reflect recent changes.

IMPORTANT: Use even when you think you know the answer. Verify against current docs.

Always use for: API syntax questions, configuration options, version migration issues, "how do I" questions mentioning a library name, debugging that involves library-specific behavior, setup instructions, and CLI tool usage.

When NOT to use: refactoring, writing scripts from scratch, debugging business logic, code review, general programming concepts the user already understands.

## Steps

1. Resolve library: `npx ctx7@latest library <name> "<user's question>"`
2. Pick the best match from results
3. Fetch docs: `npx ctx7@latest docs <libraryId> "<user's question>"`
4. Answer using the fetched documentation

Use descriptive queries (the user's full question), not single words. Do not run more than 3 commands per question. If results don't look right, try the full name with punctuation (e.g., "next.js" not "nextjs").

For details on authentication, version-specific IDs, and library resolution tips, see the `find-docs` skill if available.
