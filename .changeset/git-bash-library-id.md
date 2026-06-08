---
"ctx7": patch
---

Recover Context7 library IDs that Git Bash mangles on Windows. Git Bash rewrites a leading-slash argument like `/facebook/react` into a Windows path under the Git install dir (`C:/Program Files/Git/facebook/react`), causing `ctx7 docs` to reject it as invalid; this mainly affected users running ctx7 through Claude Code. The CLI now detects and undoes the conversion before validation, accepts the `//owner/repo` escape, and points users at that workaround for install layouts it can't auto-detect.
