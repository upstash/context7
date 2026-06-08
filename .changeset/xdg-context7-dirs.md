---
"ctx7": patch
---

Store CLI files in XDG Base Directory locations instead of `~/.context7`. Credentials move to `$XDG_CONFIG_HOME/context7` (default `~/.config/context7`), updater state to `$XDG_STATE_HOME/context7` (default `~/.local/state/context7`), and `generate` previews to `$XDG_CACHE_HOME/context7` (default `~/.cache/context7`). Existing files in `~/.context7` are migrated automatically on first use; migration is best-effort and falls back to reading the legacy file if it cannot complete. Relative or empty `XDG_*` values are ignored per the spec.
