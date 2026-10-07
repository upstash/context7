---
"@upstash/context7-mcp": patch
---

Over HTTP, answer `subscriptions/listen` with an acknowledgement and an immediate `complete` result instead of a "Subscription limit reached" error, and stop logging those refusals. Context7 has no change notifications, so the stream closes at once. Stdio subscriptions stay disabled. Removes the `MCP_MAX_SUBSCRIPTIONS` setting.
