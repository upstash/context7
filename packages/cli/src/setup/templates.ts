export const MCP_RULE_CONTENT = `Before answering a question about a specific library or framework's API, check whether it needs up-to-date documentation. Use Context7 MCP when the user asks about a third-party library's API, syntax, configuration, version changes, or behavior -- even for well-known libraries like React, Next.js, or Prisma. Your training data may not reflect recent API changes.

Use for: API syntax, configuration options, version migration, "how do I" questions mentioning a library, debugging library-specific behavior, setup instructions, CLI tool usage.

Do not use for: refactoring code, writing scripts from scratch, debugging business logic, code review, general programming concepts.

## When you decide Context7 is needed

1. Call \`resolve-library-id\` with the library name and the user's question
2. Pick the best match -- prefer exact names and version-specific IDs when a version is mentioned
3. Call \`query-docs\` with the selected library ID and the user's question
4. Answer using the fetched docs
`;

export const CLI_RULE_CONTENT = `Before answering a question about a specific library or framework's API, check whether it needs up-to-date documentation. Use the Context7 CLI when the user asks about a third-party library's API, syntax, configuration, version changes, or behavior -- even for well-known libraries like React, Next.js, or Prisma. Your training data may not reflect recent API changes.

Use for: API syntax, configuration options, version migration, "how do I" questions mentioning a library, debugging library-specific behavior, setup instructions, CLI tool usage.

Do not use for: refactoring code, writing scripts from scratch, debugging business logic, code review, general programming concepts.

## When you decide Context7 is needed

Use the \`ctx7\` CLI:

1. Resolve library: \`ctx7 library <name> "<query>"\`
2. Pick the best match from results
3. Fetch docs: \`ctx7 docs <libraryId> "<query>"\`
4. Answer using the fetched documentation
`;

