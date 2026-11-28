---
"@upstash/context7-mcp": patch
---

The stdio server keeps the experimental tools lookup in a private on-disk cache for 5 minutes, so new sessions do not each call the Context7 API. A dashboard change shows when the server starts at least 5 minutes later.
