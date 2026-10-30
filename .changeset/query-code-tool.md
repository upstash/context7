---
"@upstash/context7-mcp": minor
"ctx7": minor
---

Add the `query-code` MCP tool and the `ctx7 code` command. They search and read a library's source code at the version its docs describe: `grep` with ripgrep's options, plus `search` (by meaning), `definition`, `references`, `outline`, `read` and `list`. The MCP tool is off by default: enable it with `--query-code` or `CONTEXT7_QUERY_CODE=1`.
