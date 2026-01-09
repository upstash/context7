# @upstash/context7-tools-ai-sdk

## 0.2.1

### Patch Changes

- 07a53dc: Upgrade ai peer dependency to >=6.0.0 for AI SDK v6 compatibility

## 0.2.0

### Minor Changes

- 9412e62: feat: Change SDK default response type from "txt" to "json" for both searchLibrary and getContext methods. AI SDK tools now explicitly use type: "txt" for LLM-friendly text responses.

### Patch Changes

- Updated dependencies [9412e62]
  - @upstash/context7-sdk@0.3.0

## 0.1.0

### Minor Changes

- b3cd38a: feat: Rename tools to match MCP naming conventions
  - Rename `resolveLibrary` to `resolveLibraryId` with new `query` parameter
  - Rename `getLibraryDocs` to `queryDocs` with new `query` parameter (replaces `topic`)
  - Rename `RESOLVE_LIBRARY_DESCRIPTION` to `RESOLVE_LIBRARY_ID_DESCRIPTION`
  - Rename `GET_LIBRARY_DOCS_DESCRIPTION` to `QUERY_DOCS_DESCRIPTION`
  - Update type re-exports to match new SDK types (Library, Documentation, GetContextOptions)
  - Remove deprecated `defaultMaxResults` option from Context7ToolsConfig and Context7AgentConfig
  - Add rate limiting guidance to tool descriptions

### Patch Changes

- Updated dependencies [b3cd38a]
  - @upstash/context7-sdk@0.2.0
