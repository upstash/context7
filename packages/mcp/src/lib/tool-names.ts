export const QUERY_DOCS_TOOL = "query-docs" as const;
/** Previous tool name accepted by the request redirect. */
export const GET_LIBRARY_DOCS_TOOL = "get-library-docs" as const;
export const RESOLVE_LIBRARY_ID_TOOL = "resolve-library-id" as const;

export const MCP_TOOL_NAMES = [QUERY_DOCS_TOOL, RESOLVE_LIBRARY_ID_TOOL] as const;

export type McpTool = (typeof MCP_TOOL_NAMES)[number];
export type ToolCallOutcome = "error" | "not_found" | "success";
