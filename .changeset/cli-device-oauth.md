---
"ctx7": minor
---

Add OAuth 2.0 device authorization flow (RFC 8628) for `ctx7 login` and `ctx7 setup`. Required for headless / remote hosts (SSH, Codespaces, Docker, CI) where the existing localhost-callback flow can't work — the browser was opening on the user's laptop while the callback listener ran on the remote host.

The new flow prints a verification URL and short code, then polls a token endpoint. The user visits the URL on any device, signs in, and approves; the CLI receives the same `ctx7sk-…` API key it would have gotten from the legacy flow. Device flow is selected automatically when `SSH_CONNECTION` is set or `$DISPLAY` is missing on Linux, and can be forced with `ctx7 login --device`. Polling tolerates transient network errors and 5xx responses without ending the session.
