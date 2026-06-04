---
"ctx7": patch
---

`ctx7 login` now always uses the device-code flow. The localhost-callback path is removed — every install (laptop, SSH, Codespace, Docker, CI) goes through the same boxed prompt and verification page. Drops the `--device` flag (it was the opt-in for what's now the default). Older CLI versions (≤ 0.5.0) continue to work against the unchanged auth endpoints, so pinned installs are unaffected.
