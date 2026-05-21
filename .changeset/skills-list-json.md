---
"ctx7": patch
---

Add `--json` flag to `ctx7 skills list` for machine-parseable output. Emits `{ skills: [{ name, path, source }] }` where `path` is absolute and `source` is the agent type (`universal`, `claude`, `cursor`, `antigravity`). Matches the existing `--json` pattern on `ctx7 library` and `ctx7 docs`.
