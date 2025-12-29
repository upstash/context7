---
"@upstash/context7-mcp": major
---

Upgrade MCP server to v2.0.0 with intelligent query-based architecture

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