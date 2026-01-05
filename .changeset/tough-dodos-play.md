---
"@upstash/context7-sdk": minor
---

feat: Simplify SDK API

- Replace `getDocs()` with `getContext(query, libraryId, options)` - now takes a query parameter for relevance-based retrieval
- Update `searchLibrary(query, libraryName)` to take both query and libraryName parameters
- Replace response types: `Library` and `Documentation` instead of `SearchResult`, `CodeDocsResponse`, `InfoDocsResponse`, etc.
- Remove pagination, mode, topic, and limit options from context retrieval
- Simplify `GetContextOptions` to only include `type: "json" | "txt"`