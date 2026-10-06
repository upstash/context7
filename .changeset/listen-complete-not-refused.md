---
"@upstash/context7-mcp": patch
---

Answer `subscriptions/listen` with an acknowledgement and an immediate `complete` result instead of a "Subscription limit reached" error, and stop logging those refusals. Context7 has no change notifications, so the stream still closes at once. Removes the `MCP_MAX_SUBSCRIPTIONS` setting.
