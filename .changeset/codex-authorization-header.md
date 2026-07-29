---
"ctx7": patch
---

`ctx7 setup` now writes the API key as a standard `Authorization: Bearer <key>` header instead of a custom `CONTEXT7_API_KEY` header. Codex decides whether a server authenticates via OAuth by checking only for `bearer_token_env_var` or a header literally named `Authorization`, so a custom header name let a stored OAuth credential shadow the API key: Codex refreshed that credential during startup and, when the refresh token was dead, the server failed to start with `invalid_grant` before the API key was ever sent. Re-running setup could not fix it because setup writes `config.toml` and never touches Codex's credential store. Setup now also reports when Codex still holds an unused OAuth credential and prints the `codex mcp logout` command that clears it. The hosted endpoint accepts both header forms, so existing configs keep working.
