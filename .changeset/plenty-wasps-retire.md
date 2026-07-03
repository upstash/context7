---
"@upstash/context7-tools-ai-sdk": patch
"ctx7": patch
"@upstash/context7-mcp": patch
"@upstash/context7-pi": patch
---

Clarify the `query-docs` query description so it asks for a single concept per query. When a question spans multiple distinct topics, callers are now told to make a separate query per concept instead of combining them (unless the question is about how the concepts interact), which avoids diluted, shallow results. Applied consistently across the MCP server, CLI, pi, and AI SDK tools.
