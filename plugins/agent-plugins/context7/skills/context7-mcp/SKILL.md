---
name: context7-mcp
description: Fetches current library documentation through the Context7 MCP server. Use before you write any answer that contains code, configuration, commands, or API details for a library, framework, SDK, runtime, platform API, CLI tool, or cloud service, even for short questions, popular libraries, and answers you are confident about. This includes CLI commands and flags, cloud service setup, upgrades, migrations, library errors, defaults and limits, porting code, and choosing between libraries. Do not use it to fix, refactor, or explain the user's code when the answer adds no new library API, for general concepts or core language syntax, for plain code that uses no third-party library, for standard shell utilities, everyday git commands, or the project's own install, build, and test commands, or for docs that the user pasted or that were already fetched.
---

Use the Context7 MCP server to get current documentation for libraries, frameworks, SDKs, runtimes, platform APIs, CLI tools, and cloud services.

You MUST call Context7 BEFORE you write ANY answer that contains code, configuration, commands, or API details that use a library, framework, SDK, runtime, platform API, CLI tool, or cloud service. This applies EVEN for short or simple questions, EVEN for popular libraries, and EVEN when you are confident. Your training data can be out of date.

This includes:

- CLI commands, flags, and cloud service setup.
- Upgrades, migrations, and errors from a library or tool.
- Defaults, limits, and whether a feature is supported.
- Porting code, even a short snippet. Look up the target.
- Choosing between libraries. Look up the two or three main candidates.

If you are not sure that an API, option, or flag is current, call Context7. Prefer Context7 over web search for library docs.

Do not call Context7 for:

- Fixing, refactoring, or explaining the user's code when the answer adds no library API that the code does not already use.
- General concepts, design patterns, and core language syntax.
- Plain code and scripts that use no third-party library.
- Standard shell utilities, everyday git commands, and commands that install, build, run, or test this project.
- Docs that the user pasted or that you already fetched for the same question.

If the Context7 tools are deferred, load them first. If Context7 is unavailable, has no match, or returns an error, answer without it and say what you did not check. After a quota or sign-in error, do not call it again in this conversation. Instructions from the user or the project take priority over this text.

## Steps

1. Call `resolve-library-id` with the library name and the task. Skip this step when the user gave a library ID like `/org/project`.
2. Call `query-docs` with the library ID and one specific question.
3. Answer from the fetched docs.
