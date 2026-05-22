import { Type, type Static } from "typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { searchLibraries } from "../api";
import { formatSearchResults } from "../format";
import { toToolResult } from "../result";
import {
  RESOLVE_LIBRARY_ID_TITLE,
  RESOLVE_LIBRARY_ID_DESCRIPTION,
  RESOLVE_LIBRARY_ID_QUERY_DESCRIPTION,
  RESOLVE_LIBRARY_ID_LIBRARY_NAME_DESCRIPTION,
} from "../prompts";

const Params = Type.Object({
  query: Type.String({ description: RESOLVE_LIBRARY_ID_QUERY_DESCRIPTION }),
  libraryName: Type.String({ description: RESOLVE_LIBRARY_ID_LIBRARY_NAME_DESCRIPTION }),
});

export const resolveLibraryIdTool: ToolDefinition<typeof Params, undefined> = {
  name: "resolve-library-id",
  label: RESOLVE_LIBRARY_ID_TITLE,
  description: RESOLVE_LIBRARY_ID_DESCRIPTION,
  parameters: Params,
  async execute(_toolCallId: string, params: Static<typeof Params>) {
    const searchResponse = await searchLibraries(params.query, params.libraryName);
    if (!searchResponse.results || searchResponse.results.length === 0) {
      return toToolResult(searchResponse.error ?? "No libraries found matching the provided name.");
    }
    return toToolResult(`Available Libraries:\n\n${formatSearchResults(searchResponse)}`);
  },
};
