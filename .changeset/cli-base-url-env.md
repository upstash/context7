---
"ctx7": patch
---

`ctx7` reads the deployment URL from `CONTEXT7_BASE_URL` when `--base-url` is not passed, so on-premise users set it once instead of on every command. `--base-url` still wins when both are set, and a custom URL from either source turns off the update check and telemetry.

For a custom deployment, `ctx7` no longer sends the `ctx7 login` session (or refreshes it against that host); it authenticates with `CONTEXT7_API_KEY` only.
