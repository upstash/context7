---
"@upstash/context7-mcp": minor
"ctx7": patch
---

Replace the experimental `query-code` tool with `grep-code`, `glob-code`, `read-code` and `find-symbol`. They take the parameters of the Grep, Glob and Read tools that coding agents have, so agents search the library instead of the local project. The rule that `ctx7 setup` installs names the new tools.
