---
"ctx7": minor
---

Add `ctx7 get-upgrade-guide <libraryId> <fromVersion> [toVersion]`, the CLI counterpart of the `get-upgrade-guide` MCP tool. It prints the guide between two versions of a library, with `--page` for long guides and `--json`, and exits with code 75 while the guide is being prepared.
