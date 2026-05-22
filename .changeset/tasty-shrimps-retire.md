---
"@upstash/context7-mcp": patch
---

Reduce Redis writes on `refresh` by checking the remaining TTL first and only issuing `EXPIRE` when the session is within one day of expiry.
