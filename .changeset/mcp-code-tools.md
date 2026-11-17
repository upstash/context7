---
"@upstash/context7-mcp": patch
---

Replace the experimental `query-code` tool with `grep-code`, `glob-code`, `read-code` and `find-symbol`. `query-code` is removed; a dashboard choice that turned it on now turns on the new tools. They take the parameters of the Grep, Glob and Read tools that coding agents have, so agents search the library instead of the local project.
