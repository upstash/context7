---
"ctx7": patch
---

Validate skill names during `ctx7 skills install` to prevent path traversal. A malicious remote `SKILL.md` with a `name:` value like `..` could previously cause files to be written outside the skills root (e.g. `~/.claude/settings.json`), enabling RCE via Claude Code hooks. Names are now restricted to a safe character set and the install sinks assert the resolved directory is a direct child of the skills root before any write. Reported by Yuto Kitadai.
