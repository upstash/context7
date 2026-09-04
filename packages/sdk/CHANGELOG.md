# @upstash/context7-sdk

## 0.4.0

### Minor Changes

- 4eff2b9: Fix response type inference for runtime-selected formats, honor disabled retries, and separate deterministic SDK tests from live API integration tests. Calls that forward options whose response format is selected at runtime now correctly return an array-or-string union and may require result narrowing.

  Add production HTTP controls while keeping API-key authentication required: client and per-request timeouts, abort signals, configurable transient HTTP retries, native fetch cache settings, custom fetch/base URL/header/keepalive support, URL validation, response metadata hooks, and structured `Context7Error` fields for status, code, request ID, rate limits, retryability, malformed JSON, and cause.

  Requests now time out after 30 seconds by default. Set `timeout: false` on the client or an individual request to disable the timeout.

## 0.3.1

### Patch Changes

- f327589: Avoid throwing a raw `SyntaxError` when the server returns a non-JSON error body. `HttpClient.request()` now wraps the error-path `res.json()` in a `.catch`, so non-JSON responses (HTML 502s, plain-text 429s, Cloudflare challenge pages) fall back to `res.statusText` and always surface as a typed `Context7Error`.

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
