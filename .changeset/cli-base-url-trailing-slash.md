---
"ctx7": patch
---

Drop trailing slashes from `--base-url` and `CONTEXT7_BASE_URL` before building request URLs, so `https://context7.com/` is still the hosted deployment and keeps the logged-in token
