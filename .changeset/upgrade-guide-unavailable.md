---
"@upstash/context7-mcp": patch
---

`get-upgrade-guide` no longer tells the agent never to retry a guide that could not be prepared: the agent uses `query-docs` now and calls again only after the time the answer gives, which ranges from minutes to a day. Telemetry records an unavailable guide as `unavailable` and a page past the last as `invalid`, instead of `not_found`; neither is shown to the agent as an error.
