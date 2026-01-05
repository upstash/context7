---
"@upstash/context7-tools-ai-sdk": minor
---

feat: Rename tools to match MCP naming conventions

- Rename `resolveLibrary` to `resolveLibraryId` with new `query` parameter
- Rename `getLibraryDocs` to `queryDocs` with new `query` parameter (replaces `topic`)
- Rename `RESOLVE_LIBRARY_DESCRIPTION` to `RESOLVE_LIBRARY_ID_DESCRIPTION`
- Rename `GET_LIBRARY_DOCS_DESCRIPTION` to `QUERY_DOCS_DESCRIPTION`
- Update type re-exports to match new SDK types (Library, Documentation, GetContextOptions)
- Remove deprecated `defaultMaxResults` option from Context7ToolsConfig and Context7AgentConfig
- Add rate limiting guidance to tool descriptions