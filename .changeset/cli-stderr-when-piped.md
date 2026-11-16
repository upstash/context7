---
"ctx7": patch
---

When stdout is piped, `ctx7` writes warnings, errors and their hints to stderr, so `ctx7 code ... | grep x` still shows the "being indexed" notice and errors. `--json` output stays on stdout.
