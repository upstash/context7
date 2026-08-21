---
"ctx7": minor
---

Add `ctx7 update` to refresh installed skills and rules

Skills and rules are now versioned by a checked-in content manifest and tracked
in the CLI state file, so content changes reach existing installs without a CLI
release. Locally modified files are detected and skipped unless `--force` is
passed.
