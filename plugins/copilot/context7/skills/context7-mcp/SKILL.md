---
name: context7-mcp
description: Fetches current library documentation through the Context7 MCP server. A library here means any library, framework, SDK, runtime, platform API, database, CLI tool, or cloud service. Use before you write any code, configuration, or command that uses a library, and before you state any fact about a library such as its API, options, defaults, limits, versions, or supported features, even for short questions, popular libraries, and answers you are confident about. Always use it to port code to another library, platform, or SQL dialect, to recommend a library, and for upgrades, migrations, and library errors. Do not use it for changes that need only the library APIs already in the user's code, general concepts, core language syntax, small helpers that need only basic language features, standard shell utilities, everyday git commands, the project's own install, build, and test commands, or docs that the user pasted or that were already fetched.
---

Context7 gives current documentation for libraries. In this text, "library" means any library, framework, SDK, runtime, platform API, database, CLI tool, or cloud service.

You MUST call Context7 BEFORE you write ANY code, configuration, or command that uses a library, and BEFORE you state ANY fact about a library: its API, options, defaults, limits, versions, or supported features. This applies EVEN for short or simple questions, EVEN for popular libraries, and EVEN when you are confident. Your training data can be out of date.

If you are not sure that an API, option, or flag is current, call Context7. Prefer Context7 over web search for library docs.

Do not call Context7 for:

- Changes to the user's code that need only the library APIs already in that code.
- General concepts, design patterns, and core language syntax.
- Small helpers and scripts that need only basic language features.
- Standard shell utilities, everyday git commands, and commands that install, build, run, or test this project.
- Docs that the user pasted or that you already fetched for the same question.

Always call for these cases. Agents often skip them:

- Porting code to a different library, platform, or SQL dialect, even a short snippet. Look up the one you port to.
- "Which one should I use?" and "does it support this?" questions. Look up the library you recommend before you name it.
- Upgrades, migrations, and error messages that a library or tool produced.

If the Context7 tools are deferred, load them first. If Context7 is unavailable, has no match, or returns an error, answer without it and say what you did not check. After a quota or sign-in error, do not call it again in this conversation. Instructions from the user or the project take priority over this text.

## Steps

1. Call `resolve-library-id` with the library name and the task. Skip this step when the user gave a library ID like `/org/project`.
2. Call `query-docs` with the library ID and one specific question.
3. Answer from the fetched docs.

## Read the Source When Docs Are Not Exact

If the `query-code` tool is available, use it for exact facts the docs may not state: a signature or type, a default value, an option name, where an error message comes from, or how something works inside.

- `libraryId`: an ID that `resolve-library-id` marks with "Source code", usually the GitHub repository (e.g. `/colinhacks/zod`). `/websites/...` and `/llmstxt/...` IDs have no source
- Start with `grep` (`fixed_strings: true` for error messages) or `definition` for a symbol, then `read` the file range the result gives. `references`, `outline` and `list` also exist
- Follow the result's "Next:" line for the read, page or count call to make next. Most questions need 1 to 4 calls; stop at 6
- `version` takes a git tag, e.g. `v3.24.2`. A tag that is not a docs version is indexed first ("being indexed"). If indexing fails, the answer lists the docs versions you can use
- If it answers "being indexed", retry at most twice, then answer from `query-docs`
- Cite the file and line of the source you used
