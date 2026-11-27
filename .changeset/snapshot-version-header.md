---
"@upstash/context7-mcp": patch
---

The hosted HTTP server sends the version of the snapshots it holds in `X-Context7-Snapshot-Version`, so polls without a change skip the download again.
