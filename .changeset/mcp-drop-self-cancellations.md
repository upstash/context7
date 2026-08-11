---
"@upstash/context7-mcp": patch
---

Disable SSE keepalive heartbeats on the HTTP handler (`keepAliveMs: 0`). Every tool is a millisecond vector query, so no legitimate exchange needs a heartbeat — but a hung exchange kept alive by heartbeats can never be reaped by a proxy's stream idle timeout. One such hang is deterministic: a 2025-era JSON-RPC batch carrying a request plus its own `notifications/cancelled` gets no response for the cancelled request (per spec), the SDK transport then never closes the stream, and heartbeats kept it alive until the gateway's 1200s hard cap — the dominant source of leaked upstream connections in the 2026-08-11 mcp.context7.com outage. With heartbeats off, silent hangs go idle and the proxy reaps them at its idle timeout.
