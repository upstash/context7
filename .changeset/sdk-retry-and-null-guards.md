---
"@upstash/context7-sdk": patch
---

Retry transient HTTP errors and harden response parsing. `HttpClient` now retries `429` (respecting the `Retry-After` header) and `5xx` responses using the configured backoff, and `retry: false` now performs exactly one attempt. `searchLibrary` and `getContext` tolerate missing array fields in the API response instead of throwing.
