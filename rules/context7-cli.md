Use the `ctx7` CLI to fetch current documentation whenever the user asks about a library, framework, SDK, API, CLI tool, or cloud service — even well-known ones like React, Next.js, Prisma, Express, Tailwind, Django, or Spring Boot. This includes API syntax, configuration, version migration, porting code between libraries, platforms, or SQL dialects, library-specific debugging, setup instructions, and CLI tool usage. Use even when you think you know the answer — your training data may not reflect recent changes. Prefer this over web search for library docs.

Do not use for: refactoring, debugging, or reviewing code that does not depend on a library or platform API, or general programming concepts.

## Steps

1. Resolve library: `npx ctx7@latest library <name> "<what to look up>"` — use the official library name with proper punctuation (e.g., "Next.js" not "nextjs", "Customer.io" not "customerio", "Three.js" not "threejs")
2. Pick the best match (ID format: `/org/project`) by: exact name match, description relevance, code snippet count, source reputation (High/Medium preferred), and benchmark score (higher is better). If results don't look right, try alternate names or queries (e.g., "next.js" not "nextjs", or rephrase the question)
3. Fetch docs: `npx ctx7@latest docs <libraryId> "<what to look up>"` — run a separate `docs` command per distinct concept if the question spans multiple topics, unless it's about how they interact
4. Answer using the fetched documentation

## Library source code

When the docs do not answer an exact question (a signature or type, a default value, an option name, where an error message comes from, or how something works inside), search the library's source at the docs version.

- Grep: `npx ctx7@latest code <libraryId> "<regex>"`. Add `-F` for plain text such as error messages
- Definition: `npx ctx7@latest code <libraryId> <symbol> --op definition`. Read code: `npx ctx7@latest code <libraryId> --op read --path <file>#L10-L40`. `--op references`, `--op outline` and `--op list` also exist
- Use an ID that `library` marks with "Source code", usually the GitHub repository. `/websites/...` and `/llmstxt/...` IDs have no source
- For a version, add the git tag to the library ID (e.g. `/colinhacks/zod/v3.24.2`). A tag that is not a docs version is indexed first (exit code 75). If indexing fails, the output lists the docs versions you can use
- Follow the `Next:` line of the output. Its fields map to flags: `offset` is `--offset`, `output_mode "count"` is `-c`, `fixed_strings` is `-F`, `ignore_case` is `-i`, `read: <file>#L..` is `--op read --path <file>#L..`, and the other fields use the flag of the same name (`head_limit` is `--head-limit`, `version` is `--tag`)
- Exit code 75 means the source is being indexed: retry at most twice, then answer from `docs`
- Cite the file and line of the source you used

You MUST call `library` first to get a valid ID unless the user provides one directly in `/org/project` format. Be specific about what to look up in the library's documentation — specific and detailed queries return better results than vague single words, but keep each query to a single concept unless the question is about how concepts interact; combined multi-topic queries dilute ranking and return shallow results for each topic. Do not run more than 3 `library` and `docs` commands per question, and not more than 6 `code` commands. Do not include sensitive information (API keys, passwords, credentials) in queries.

For version-specific docs, use `/org/project/version` from the `library` output (e.g., `/vercel/next.js/v16.2.9`).

If a command fails with a quota error, inform the user and suggest `npx ctx7@latest login` or setting `CONTEXT7_API_KEY` env var for higher limits. Do not silently fall back to training data.
