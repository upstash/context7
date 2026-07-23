---
"ctx7": patch
---

Fix `ctx7 setup` skill install failing with "fetch failed" when the GitHub git tree API (`api.github.com`) is blocked or unreachable. Skill download now falls back to fetching the single `SKILL.md` directly from `raw.githubusercontent.com` — the URL the docs API already resolves — so setup succeeds in environments where only the docs/raw hosts are reachable.
