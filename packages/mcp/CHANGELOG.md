# @upstash/context7-mcp

## 2.1.0

### Minor Changes

- ef82f30: Add OAuth 2.0 authentication support for MCP server
  - Add new `/mcp/oauth` endpoint requiring JWT authentication
  - Implement JWT validation against authorization server JWKS
  - Add OAuth Protected Resource Metadata endpoint (RFC 9728) at `/.well-known/oauth-protected-resource`
  - Include `WWW-Authenticate` header for OAuth discovery

## 2.0.2

### Patch Changes

- 368b143: Collect client and server version metrics

## 2.0.1

### Patch Changes

- 93a2d5b: Adds MCP tool annotations (readOnlyHint) to all tools to help MCP clients better understand tool behavior and make safer decisions about tool execution.

## 2.0.0

### Major Changes

- 66ea0d6: Upgrade MCP server to v2.0.0 with intelligent query-based architecture

  Breaking Changes
  - Removed get-library-docs tool, replaced with new query-docs tool
  - resolve-library-id now requires both query and libraryName parameters
  - Removed mode, topic, page, and limit parameters from documentation fetching
  - Renamed context7CompatibleLibraryID parameter to libraryId

  New Features
  - Intelligent reranked and deduplicated library selection based on user intent
  - Smart snippet selection with relevance-based ranking for documentation retrieval
  - Query-driven context fetching that understands what the user is trying to accomplish
  - Added security warnings for sensitive data in query parameters
  - Added tool call limits (max 3 calls per question) to prevent excessive context window usage

  Improvements
  - Simplified API key header extraction (removed redundant case variants)
  - Removed unused actualPort variable and dead code
  - Cleaner type definitions with new ContextRequest and ContextResponse types
  - Better error messages for library search failures

## 1.0.33

### Patch Changes

- a5228fd: Fix API key not being passed in resolve-library-id tool when using stdio transport

## 1.0.32

### Patch Changes

- ad23996: Remove masked API key display from unauthorized error responses
- aa12390: Improve error message handling by using the responses from the server.

## 1.0.31

### Patch Changes

- 6255e26: Migrate to pnpm monorepo structure
