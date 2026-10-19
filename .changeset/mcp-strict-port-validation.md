---
"@upstash/context7-mcp": patch
---

`--port` rejects values that are not an integer from 0 to 65535, and the port-in-use retry stops at 65535 instead of crashing.
