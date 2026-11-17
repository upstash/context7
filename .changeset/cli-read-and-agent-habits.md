---
"ctx7": minor
---

Add `ctx7 read <libraryId> <target>` to read a file range or a symbol's definition, and print `Next:` reads as `ctx7 read` commands. `ctx7 code` takes folders or files after the pattern, as in `rg PATTERN PATH`, and accepts `-n`, `--limit` and `--max-results` (for `--head-limit`), `--path-filter`, `--query`, `--search` and `--library`. An unquoted phrase or a version written as its own argument now fails with the command to run instead.
