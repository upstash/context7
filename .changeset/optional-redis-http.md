---
"@upstash/context7-mcp": minor
---

Make Upstash Redis optional for the HTTP transport. When `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` are not set, the server now runs statelessly (no session tracking) instead of failing to start, so `--transport http` works standalone on a single instance — for example in the official Docker image. Configure Redis to share and validate sessions across multiple instances.
