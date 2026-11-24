---
"ctx7": patch
---

`ctx7 setup --base-url` writes a keyless MCP entry when the on-premise deployment uses OAuth sign-in, so the client signs in through the browser. `--oauth` now works with on-premise deployments that offer OAuth. Setup ignores a `CONTEXT7_API_KEY` that is not an on-premise personal key, and warns when it ignores one.
