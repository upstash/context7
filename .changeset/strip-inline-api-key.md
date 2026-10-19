---
"ctx7": patch
---

`ctx7 setup` now removes an existing `--api-key=<value>` arg when it rewrites a stdio MCP entry, so switching to OAuth or rotating the key no longer leaves the old key in the config.
