---
"@upstash/context7-mcp": minor
---

Add the experimental Context7 Search API tool mode. `--tool-mode single` (or
`CONTEXT7_MCP_TOOL_MODE=single`) exposes one natural-language `query-docs` tool
that selects and retrieves documentation in one bounded backend request.
Optional fuzzy library, exact library ID, and version hints improve explicit
requests without adding another tool call. Retry metadata prevents repeated
calls for terminal misses while preserving retry behavior for transient
failures. The existing two-tool flow remains the default.
