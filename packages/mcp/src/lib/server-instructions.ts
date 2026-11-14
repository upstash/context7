import { DOCS_FEEDBACK_INSTRUCTIONS } from "./research-preview-tools.js";

/**
 * Server instructions that MCP clients add to the agent's system prompt.
 * The call rule is direct on purpose: with softer wording, agents answer library
 * questions from memory. The "Do not call" list keeps lookups out of routine work.
 * It names no libraries, so it works the same for every user.
 * Keep it short: Claude Code cuts server instructions after 2048 characters, and a
 * short text also works better with GPT-based agents that get it as a rule file.
 */
export const SERVER_INSTRUCTIONS = `Context7 gives current documentation for libraries. In this text, "library" means any library, framework, SDK, runtime, platform API, database, CLI tool, or cloud service.

You MUST call Context7 BEFORE you write ANY code, configuration, or command that uses a library, and BEFORE you state ANY fact about a library: its API, options, defaults, limits, versions, or supported features. This applies EVEN for short or simple questions, EVEN for popular libraries, and EVEN when you are confident. Your training data can be out of date.

If you are not sure that an API, option, or flag is current, call Context7. Prefer Context7 over web search for library docs.

Do not call Context7 for:
- Changes to the user's code that need only the library APIs already in that code.
- General concepts, design patterns, and core language syntax.
- Small helpers and scripts that need only basic language features.
- Standard shell utilities, everyday git commands, and commands that install this project's dependencies, or build, run, or test it.
- Docs that the user pasted or that you already fetched in this conversation.

Always call for these cases. Agents often skip them:
- Porting code to a different library, platform, or SQL dialect, even a short snippet. Look up the one you port to.
- "Which one should I use?" and "does it support this?" questions. Look up the library you recommend.
- Upgrades, migrations, and error messages that a library or tool produced.

If the Context7 tools are deferred, load them first. If Context7 is unavailable, has no match, or returns an error, answer without it and say what you did not check. After a quota or sign-in error, do not retry it for the same question. Instructions from the user or the project take priority over this text.`;

/** Claude Code cuts server instructions after this many characters (CLAUDE_CODE_MAX_MCP_DESCRIPTION_LENGTH). */
export const CLAUDE_CODE_INSTRUCTIONS_LIMIT = 2048;

/** The instructions a session gets: the base text, plus the feedback request under research preview. */
export function serverInstructions(researchPreview: boolean): string {
  return researchPreview
    ? `${SERVER_INSTRUCTIONS}\n\n${DOCS_FEEDBACK_INSTRUCTIONS}`
    : SERVER_INSTRUCTIONS;
}
