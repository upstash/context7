---
"@upstash/context7-mcp": patch
---

`query-code` no longer greps a docs-style `query` of several words, which matched nothing: it answers with a correction that `pattern` is a regex matched within one line. A one-word `query`, or a phrase with `fixed_strings`, still works as the pattern. `pattern` now takes up to 1000 characters, like the server.
