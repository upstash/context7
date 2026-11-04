Use the Context7 CLI (`ctx7`) to get current documentation for libraries, frameworks, SDKs, runtimes, platform APIs, CLI tools, and cloud services.

You MUST run `ctx7` BEFORE you write ANY answer that contains code, configuration, commands, or API details that use a library, framework, SDK, runtime, platform API, CLI tool, or cloud service. This applies EVEN when the question is short or simple, EVEN for popular and well-known libraries, and EVEN when you are confident that you know the answer. Your training data can be out of date: function names, options, flags, and config keys change between versions.

This includes:

- Short or keyword-only questions.
- CLI commands and flags.
- Cloud service setup and configuration.
- Version upgrades, migrations, and breaking changes.
- Errors that come from a library or tool.
- Porting or translating code from one library, framework, or SQL dialect to another, even a short snippet. Look up the target before you write the converted code.
- Choosing between libraries or services, also when the user asks for your opinion. Look up the two or three main candidates.
- Writing code, config files, or CI workflows that use a library or service.
- Defaults, limits, and whether a feature is supported.

If you are not sure that an API, option, or flag is current, run `ctx7`.

Do not run `ctx7` for:

- Work that only uses the user's own code, general programming concepts, core language syntax, standard shell utilities, or everyday git commands.
- Edits that add no new library API, option, or flag.
- Commands that you run to inspect, build, or test the project, such as listing files, running tests, or git status.
- Documentation that the user pasted, or that you already fetched in this conversation for the same concept. Reuse it, also when the user asks for more of the same pattern. For a new concept, run `ctx7 docs` again with the same ID.

If another connected tool gives official documentation for the same product, you can use it instead.

## Steps

1. Run `npx ctx7@latest library <name> "<the task>"`. Use the official library name with its punctuation (for example, "Next.js" not "nextjs"). Skip this step only when the user gave a library ID like `/org/project`, or an earlier command in this conversation returned it.
2. Pick the best match by name, description, code snippet count, source reputation, and benchmark score. If the user or the project names a version, use a matching `/org/project/version` ID from the `library` output. If that version is not listed, use the base ID.
3. Run `npx ctx7@latest docs <libraryId> "<one specific question>"`. Run one `docs` command per concept. If `docs` says that the library ID does not exist, run `library` once.
4. Write your answer from the fetched docs.

Do not put secrets, credentials, or private code in any `ctx7` command.

Run each `ctx7` command no more than 3 times per question. If you reach this limit, or `ctx7` returns no match or an error, continue with other sources or your own knowledge. Tell the user which parts you did not check against current docs. After a quota error, tell the user that `npx ctx7@latest login` or the `CONTEXT7_API_KEY` environment variable gives higher limits. After a quota or sign-in error, do not run `ctx7` again in this conversation unless the user asks.

Prefer Context7 over web search for library documentation. Instructions from the user or the project take priority over this text.
