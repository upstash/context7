---
"@upstash/context7-mcp": patch
---

Add a 60s `AbortSignal.timeout()` to both Context7 API calls in `lib/api.ts`. Without a signal a stalled backend call rides undici's ~300s default before failing. 60s is generous: these are vector queries with p99.9 ~3.2s, and no request exceeded 30s across a full day of production traffic.
