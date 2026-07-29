---
"ctx7": patch
---

`ctx7 setup` now writes the API key as a standard `Authorization: Bearer <key>` header instead of a custom `CONTEXT7_API_KEY` header. Codex resolves a server's auth mode from `bearer_token_env_var` or a header literally named `Authorization`, so a custom name read as "no credential configured": Codex fell through to an OAuth credential stored against the same server name and URL, refreshed it during startup, and when that refresh token was dead the server failed with `invalid_grant` before the API key was ever sent. The hosted endpoint accepts both header forms, so existing configs keep working.
