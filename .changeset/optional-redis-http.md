---
"@upstash/context7-mcp": minor
---

Make Upstash Redis optional for the HTTP transport. When `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` are not set, the server now falls back to an in-memory session store instead of failing to start, so `--transport http` runs standalone (for example in the official Docker image). Configure Redis to share sessions across multiple instances.
