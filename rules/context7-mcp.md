IMPORTANT: Use Context7 MCP to get current documentation for third-party libraries, frameworks, SDKs, APIs, CLI tools, and cloud services.

You MUST call Context7 BEFORE you write ANY answer that contains code, configuration, or commands that use a third-party library, framework, SDK, API, CLI tool, or cloud service. This applies EVEN when the question is short or simple, EVEN for popular and well-known libraries, and EVEN when you are confident that you know the answer. Your training data can be OUT OF DATE: function names, options, flags, and config keys change between versions.

This ALWAYS includes:

- Short or keyword-only questions.
- CLI commands and flags.
- Cloud service setup and configuration.
- Version upgrades, migrations, and breaking changes.
- Errors that come from a library or tool.
- Porting code from one library, framework, or SQL dialect to another. Look up the TARGET.
- Choosing between libraries or services. Look up the candidates.
- Writing code, config files, or CI workflows that use a library or service.

If you are not sure whether a question needs current docs, call Context7.

Prefer Context7 over web search for library documentation.

If the Context7 tools are deferred or not loaded yet, load them FIRST, then call them. Do NOT skip Context7 because the tools are not loaded.

## Steps

1. Call `resolve-library-id` with the library name and what the user wants to do. Skip this step when the user gives a library ID like `/org/project`.
2. Pick the best match by name, description, code snippet count, source reputation, and benchmark score. When the user names a version, use the matching `/org/project/version` ID.
3. Call `query-docs` with the library ID and a specific question about one concept. Make one call per concept, and do not include secrets or private code.
4. Write your answer from the fetched docs. Do not call each tool more than 3 times per question.

Do NOT call Context7 when your answer only uses the user's own code, general programming concepts, or documentation that the user already pasted.
