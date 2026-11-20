export const QUERY_DOCS_TOOL = "query-docs" as const;
export const RESOLVE_LIBRARY_ID_TOOL = "resolve-library-id" as const;
export const SUBMIT_DOCS_FEEDBACK_TOOL = "submit-docs-feedback" as const;
export const GREP_CODE_TOOL = "grep-code" as const;
export const GLOB_CODE_TOOL = "glob-code" as const;
export const READ_CODE_TOOL = "read-code" as const;
export const FIND_SYMBOL_TOOL = "find-symbol" as const;
export const GET_UPGRADE_GUIDE_TOOL = "get-upgrade-guide" as const;

/** The source code tools, listed together under the experimental tool `code-tools`. */
export const CODE_TOOL_NAMES = [
  GREP_CODE_TOOL,
  GLOB_CODE_TOOL,
  READ_CODE_TOOL,
  FIND_SYMBOL_TOOL,
] as const;
export type CodeTool = (typeof CODE_TOOL_NAMES)[number];

/** The experimental tool that lists the source code tools. */
export const CODE_TOOLS = "code-tools" as const;
/** Its name while one `query-code` tool did all of it. A stored dashboard choice may still use it. */
const LEGACY_CODE_TOOLS = "query-code";

/**
 * Experimental tools (see experimental-tools.ts). Each is listed only when it is turned on: all
 * of them with `--experimental`, `CONTEXT7_EXPERIMENTAL=1` or `?experimental=1`, or the ones the
 * signed-in user turned on at context7.com/dashboard?tab=settings. "All experimental tools"
 * there turns on every name in this list, also one the app does not list yet. Keep in step with
 * the app's `EXPERIMENTAL_TOOLS` (context7app `lib/mcp/experimentalTools.ts`).
 */
export const EXPERIMENTAL_TOOL_NAMES = [
  CODE_TOOLS,
  GET_UPGRADE_GUIDE_TOOL,
  SUBMIT_DOCS_FEEDBACK_TOOL,
] as const;

export type ExperimentalTool = (typeof EXPERIMENTAL_TOOL_NAMES)[number];

/** Known experimental tool names in catalog order, without duplicates. */
export function experimentalToolsFrom(values: unknown): ExperimentalTool[] {
  if (!Array.isArray(values)) return [];
  return EXPERIMENTAL_TOOL_NAMES.filter(
    (name) => values.includes(name) || (name === CODE_TOOLS && values.includes(LEGACY_CODE_TOOLS))
  );
}

/** The tools the server can list. `code-tools` is not one: it lists CODE_TOOL_NAMES. */
export const MCP_TOOL_NAMES = [
  QUERY_DOCS_TOOL,
  RESOLVE_LIBRARY_ID_TOOL,
  GET_UPGRADE_GUIDE_TOOL,
  SUBMIT_DOCS_FEEDBACK_TOOL,
  ...CODE_TOOL_NAMES,
] as const;

export type McpTool = (typeof MCP_TOOL_NAMES)[number];
/**
 * A tool call's telemetry outcome. Only `error` marks the MCP operation as failed and is shown to
 * the agent as `isError`; `invalid` (a request the API refused, such as a page past the last) and
 * `unavailable` (a guide that could not be prepared and is not tried again before a wait) are
 * answers the agent acts on. A guide still being prepared is `success`.
 */
export type ToolCallOutcome = "error" | "invalid" | "not_found" | "success" | "unavailable";

/**
 * The tools a stored dashboard choice `{ all, tools }` turns on. `all` is every experimental tool
 * this server has, also ones the app does not know yet; anything malformed turns on none.
 */
export function experimentalToolsFromChoice(choice: unknown): ExperimentalTool[] {
  if (!choice || typeof choice !== "object") return [];
  const { all, tools } = choice as { all?: unknown; tools?: unknown };
  return all === true ? [...EXPERIMENTAL_TOOL_NAMES] : experimentalToolsFrom(tools);
}
