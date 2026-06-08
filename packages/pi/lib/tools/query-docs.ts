import { Type, type Static } from "typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { fetchLibraryContext } from "../api";
import { toToolResult } from "../result";
import {
  QUERY_DOCS_TITLE,
  QUERY_DOCS_DESCRIPTION,
  QUERY_DOCS_LIBRARY_ID_DESCRIPTION,
  QUERY_DOCS_QUERY_DESCRIPTION,
} from "../prompts";

const Params = Type.Object({
  libraryId: Type.String({ description: QUERY_DOCS_LIBRARY_ID_DESCRIPTION }),
  query: Type.String({ description: QUERY_DOCS_QUERY_DESCRIPTION }),
});

export const queryDocsTool: ToolDefinition<typeof Params, undefined> = {
  name: "query-docs",
  label: QUERY_DOCS_TITLE,
  description: QUERY_DOCS_DESCRIPTION,
  parameters: Params,
  async execute(_toolCallId: string, params: Static<typeof Params>) {
    const text = await fetchLibraryContext(params.query, params.libraryId);
    return toToolResult(text);
  },
};
