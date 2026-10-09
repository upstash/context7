---
"@upstash/context7-mcp": patch
---

query-docs now sets `isError` on its result when the documentation request fails (invalid library ID, API or network error), so clients that branch on `isError` no longer treat the error text as documentation.
