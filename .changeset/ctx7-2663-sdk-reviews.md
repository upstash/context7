---
"@upstash/context7-sdk": minor
---

Fix response type inference for runtime-selected formats, honor disabled retries, and separate deterministic SDK tests from live API integration tests. Calls that forward options whose response format is selected at runtime now correctly return an array-or-string union and may require result narrowing.

Add production HTTP controls while keeping API-key authentication required: client and per-request timeouts, abort signals, configurable transient HTTP retries, native fetch cache settings, custom fetch/base URL/header support, response metadata hooks, and structured `Context7Error` fields for status, code, request ID, rate limits, retryability, and cause.
