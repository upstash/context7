export const QUERY_DOCS_TOOL = "query-docs" as const;
export const RESOLVE_LIBRARY_ID_TOOL = "resolve-library-id" as const;

export const SEARCH_LIBRARY_CODE_TOOL = "search-library-code" as const;
export const READ_LIBRARY_FILE_TOOL = "read-library-file" as const;

export const MCP_TOOL_NAMES = [
  QUERY_DOCS_TOOL,
  RESOLVE_LIBRARY_ID_TOOL,
  SEARCH_LIBRARY_CODE_TOOL,
  READ_LIBRARY_FILE_TOOL,
] as const;

export type McpTool = (typeof MCP_TOOL_NAMES)[number];
export type ToolCallOutcome = "error" | "not_found" | "success";
