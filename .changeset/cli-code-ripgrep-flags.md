---
"ctx7": minor
---

`ctx7 code` takes ripgrep's `-A`, `-B`, `-w` and `-m`, and prints the `Next:` hints of its answers as `ctx7 code` flags (`run again with --offset 20`, `--op read --path src/a.ts#L1-L40`, `add -F`). `ctx7 --help`, `ctx7 code --help` and `ctx7 get-upgrade-guide --help` show examples. A bare major in `get-upgrade-guide`'s `fromVersion` means the newest release of that line, and the help now says so.
