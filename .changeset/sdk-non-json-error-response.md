---
"@upstash/context7-sdk": patch
---

Avoid throwing a raw `SyntaxError` when the server returns a non-JSON error body. `HttpClient.request()` now wraps the error-path `res.json()` in a `.catch`, so non-JSON responses (HTML 502s, plain-text 429s, Cloudflare challenge pages) fall back to `res.statusText` and always surface as a typed `Context7Error`.
