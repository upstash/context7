---
"@upstash/context7-mcp": patch
---

Stop forcing `responseMode: "sse"` on the HTTP handler and use the SDK default `"auto"` instead. Forcing `"sse"` put every response on an SSE stream, and those streams were not released: concurrent upstream streams went from ~10 before v4.0.0 to over 5000, exhausting the gateway connection pool and returning 503 `reset reason: overflow` on `mcp.context7.com`. Traffic and latency were unchanged over that period, so the growth was not load.

With `"auto"` a request is answered with a single JSON body unless a handler emits a related message before its result, which upgrades that one exchange to SSE. No tool emits progress today, so modern-protocol responses are now plain JSON. The 2025-era legacy fallback is constructed without a `responseMode` and still streams over SSE, so it is unaffected.
