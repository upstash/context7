---
"ctx7": patch
"@upstash/context7-mcp": patch
---

While a library's source is being indexed, `ctx7 code` and `query-code` now say to call again for up to 3 minutes instead of at most twice: a first index usually takes 1 to 3 minutes. When the server message already gives this rule, the clients no longer repeat it.
