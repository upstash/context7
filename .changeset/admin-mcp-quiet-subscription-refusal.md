---
"@upstash/context7-admin-mcp": patch
---

Stop logging a refused `subscriptions/listen` as an error. The server allows no subscriptions, so the refusal is expected.
