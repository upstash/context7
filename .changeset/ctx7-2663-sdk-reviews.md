---
"@upstash/context7-sdk": patch
---

Fix response type inference for runtime-selected formats, honor disabled retries, and separate deterministic SDK tests from live API integration tests. Calls that forward options whose response format is selected at runtime now correctly return an array-or-string union and may require result narrowing.
