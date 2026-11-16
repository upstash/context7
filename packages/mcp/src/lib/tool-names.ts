export const QUERY_DOCS_TOOL = "query-docs" as const;
export const RESOLVE_LIBRARY_ID_TOOL = "resolve-library-id" as const;
export const SUBMIT_DOCS_FEEDBACK_TOOL = "submit-docs-feedback" as const;
export const QUERY_CODE_TOOL = "query-code" as const;
export const GET_UPGRADE_GUIDE_TOOL = "get-upgrade-guide" as const;

/**
 * Experimental tools (see experimental-tools.ts). Each is listed only when it is turned on: all
 * of them with `--experimental`, `CONTEXT7_EXPERIMENTAL=1` or `?experimental=1`, or the ones the
 * signed-in user turned on at context7.com/dashboard?tab=settings. "All experimental tools"
 * there turns on every name in this list, also one the app does not list yet. Keep in step with
 * the app's `EXPERIMENTAL_TOOLS` (context7app `lib/mcp/experimentalTools.ts`).
 */
export const EXPERIMENTAL_TOOL_NAMES = [
  QUERY_CODE_TOOL,
  GET_UPGRADE_GUIDE_TOOL,
  SUBMIT_DOCS_FEEDBACK_TOOL,
] as const;

export type ExperimentalTool = (typeof EXPERIMENTAL_TOOL_NAMES)[number];

/** Known experimental tool names in catalog order, without duplicates. */
export function experimentalToolsFrom(values: unknown): ExperimentalTool[] {
  if (!Array.isArray(values)) return [];
  return EXPERIMENTAL_TOOL_NAMES.filter((name) => values.includes(name));
}

export const MCP_TOOL_NAMES = [
  QUERY_DOCS_TOOL,
  RESOLVE_LIBRARY_ID_TOOL,
  ...EXPERIMENTAL_TOOL_NAMES,
] as const;

export type McpTool = (typeof MCP_TOOL_NAMES)[number];
/**
 * A tool call's telemetry outcome. Only `error` marks the MCP operation as failed and is shown to
 * the agent as `isError`; `invalid` (a request the API refused, such as a page past the last) and
 * `unavailable` (a guide that could not be prepared and is not tried again before a wait) are
 * answers the agent acts on. A guide still being prepared is `success`.
 */
export type ToolCallOutcome = "error" | "invalid" | "not_found" | "success" | "unavailable";
