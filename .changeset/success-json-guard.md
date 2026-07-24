---
"@upstash/context7-sdk": patch
---

Convert empty or malformed successful JSON responses into a typed `Context7Error` instead of exposing a native `SyntaxError`. Valid JSON responses and retry behavior are unchanged.
