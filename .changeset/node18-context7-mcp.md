---
"@upstash/context7-mcp": patch
---

Restore Node 18 support by pinning undici to ^6.26.0 and commander to ^13.1.0, which dropped the Node 20+ engine requirements that caused a "File is not defined" crash on startup.
