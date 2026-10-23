---
"@upstash/context7-sdk": minor
---

`searchLibrary` returns an empty list (or, with `type: "txt"`, a "No libraries found" message) when nothing matches, instead of throwing a 404 `Context7Error`. Text results label the trust score as "Source Reputation", the same as the MCP server.
