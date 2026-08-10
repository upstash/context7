---
"ctx7": patch
---

Fix `ctx7 library`, `ctx7 docs` and `ctx7 skills suggest` silently falling back to anonymous requests when the stored OAuth token expires, which surfaced misleading quota errors for authenticated users. `ctx7 generate` no longer forces a full interactive re-login when the token can be refreshed instead. All four commands now go through `getValidAccessToken()`, which refreshes expired credentials.
