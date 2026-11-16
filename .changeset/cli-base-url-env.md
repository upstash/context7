---
"ctx7": patch
---

`ctx7` reads the deployment URL from `CONTEXT7_BASE_URL` when `--base-url` is not passed, so on-premise users set it once instead of on every command. `--base-url` still wins when both are set, and a custom URL from either source turns off the update check and telemetry.
