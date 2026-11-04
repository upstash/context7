import { QUERY_DOCS_TOOL, RESOLVE_LIBRARY_ID_TOOL } from "./tool-names.js";

/**
 * Server instructions that MCP clients add to the agent's system prompt.
 * The text is direct on purpose: agents answer from memory when the wording is soft.
 * It names no libraries, so it works the same for every user.
 */
export const SERVER_INSTRUCTIONS = `IMPORTANT: Use this server to get current documentation for third-party libraries, frameworks, SDKs, APIs, CLI tools, and cloud services.

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

If the Context7 tools are deferred or not loaded yet, load them FIRST, then call them. Do NOT skip Context7 because the tools are not loaded.

ALWAYS follow these steps:
1. Call \`${RESOLVE_LIBRARY_ID_TOOL}\` with the library name and the user's question.
2. Pick the best match.
3. Call \`${QUERY_DOCS_TOOL}\` with the selected library ID and the user's question.
4. Write your answer from the fetched docs.

Do NOT call Context7 when your answer only uses the user's own code, general programming concepts, or documentation that the user already pasted.`;
