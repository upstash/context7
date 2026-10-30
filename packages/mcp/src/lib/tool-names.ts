export const QUERY_DOCS_TOOL = "query-docs" as const;
export const RESOLVE_LIBRARY_ID_TOOL = "resolve-library-id" as const;
export const SUBMIT_DOCS_FEEDBACK_TOOL = "submit-docs-feedback" as const;

/** Tools listed only with research preview on (see research-preview-tools.ts). */
export const RESEARCH_PREVIEW_TOOL_NAMES = [SUBMIT_DOCS_FEEDBACK_TOOL] as const;

export const MCP_TOOL_NAMES = [
  QUERY_DOCS_TOOL,
  RESOLVE_LIBRARY_ID_TOOL,
  ...RESEARCH_PREVIEW_TOOL_NAMES,
] as const;

export type McpTool = (typeof MCP_TOOL_NAMES)[number];
export type ToolCallOutcome = "error" | "not_found" | "success";
