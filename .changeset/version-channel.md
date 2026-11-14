---
"@upstash/context7-mcp": minor
"ctx7": minor
"@upstash/context7-pi": minor
---

Agents pass the version a project uses as its own value, not as a suffix of the library ID. `query-docs` (MCP and pi) takes a `version` input and `ctx7 docs` a `--tag` option, sent to `/v2/context` as `version`; Context7 serves that version or the closest one it has. `resolve-library-id` no longer lists versions.
