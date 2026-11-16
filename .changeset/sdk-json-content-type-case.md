---
"@upstash/context7-sdk": patch
---

The SDK now reads a JSON response when the server sends a mixed-case `Content-Type`, such as `Application/Json`. Before, `searchLibrary()` threw a `TypeError` on such a response. Lookalike types such as `application/jsonp` stay on the text path.
