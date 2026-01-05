---
"@upstash/context7-tools-ai-sdk": minor
---

fix(tools-ai-sdk): update to use new SDK API

- Update type re-exports to match new SDK types (Library, Documentation, GetContextOptions instead of SearchResult, SearchLibraryResponse, etc.)
- Update resolveLibrary tool to use new searchLibrary(query, libraryName) API
- Update getLibraryDocs tool to use new getContext() API instead of getDocs()
- Remove deprecated defaultMaxResults option from Context7ToolsConfig and Context7AgentConfig