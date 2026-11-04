---
"@upstash/context7-mcp": minor
"ctx7": minor
---

Add the `query-code` MCP tool and the `ctx7 code` command. They search and read a library's source code at the version its docs describe: `grep` with ripgrep's options, plus `definition`, `references`, `outline`, `read` and `list`. `ctx7 library` marks the libraries whose source is searchable, and `resolve-library-id` does so with the research preview on. The MCP tool is part of the research preview: it is listed only with `--research-preview`, `CONTEXT7_RESEARCH_PREVIEW=1` or `?research_preview=1`.
