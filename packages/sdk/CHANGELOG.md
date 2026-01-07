# @upstash/context7-sdk

## 0.3.0

### Minor Changes

- 9412e62: feat: Change SDK default response type from "txt" to "json" for both searchLibrary and getContext methods. AI SDK tools now explicitly use type: "txt" for LLM-friendly text responses.

## 0.2.0

### Minor Changes

- b3cd38a: feat: Simplify SDK API
  - Replace `getDocs()` with `getContext(query, libraryId, options)` - now takes a query parameter for relevance-based retrieval
  - Update `searchLibrary(query, libraryName)` to take both query and libraryName parameters
  - Replace response types: `Library` and `Documentation` instead of `SearchResult`, `CodeDocsResponse`, `InfoDocsResponse`, etc.
  - Remove pagination, mode, topic, and limit options from context retrieval
  - Simplify `GetContextOptions` to only include `type: "json" | "txt"`

## 0.1.0

### Minor Changes

- 5e11d35: Initial release of the Context7 TypeScript SDK
  - HTTP/REST client for the Context7 API
  - `searchLibrary()` - Search for libraries in the Context7 database
  - `getDocs()` - Retrieve documentation with filtering options
  - Environment variable support for API key configuration
