export const QUERY_DOCS_TOOL = "query-docs" as const;
export const RESOLVE_LIBRARY_ID_TOOL = "resolve-library-id" as const;
export const SUBMIT_DOCS_FEEDBACK_TOOL = "submit-docs-feedback" as const;
export const QUERY_CODE_TOOL = "query-code" as const;
export const GET_UPGRADE_GUIDE_TOOL = "get-upgrade-guide" as const;

/** Tools listed only with research preview on (see research-preview-tools.ts). */
export const RESEARCH_PREVIEW_TOOL_NAMES = [
  SUBMIT_DOCS_FEEDBACK_TOOL,
  GET_UPGRADE_GUIDE_TOOL,
  QUERY_CODE_TOOL,
] as const;

export const MCP_TOOL_NAMES = [
  QUERY_DOCS_TOOL,
  RESOLVE_LIBRARY_ID_TOOL,
  ...RESEARCH_PREVIEW_TOOL_NAMES,
] as const;

export type McpTool = (typeof MCP_TOOL_NAMES)[number];
/**
 * A tool call's telemetry outcome. Only `error` marks the MCP operation as failed and is shown to
 * the agent as `isError`; `invalid` (a request the API refused, such as a page past the last) and
 * `unavailable` (a guide that could not be prepared and is not tried again before a wait) are
 * answers the agent acts on. A guide still being prepared is `success`.
 */
export type ToolCallOutcome = "error" | "invalid" | "not_found" | "success" | "unavailable";
