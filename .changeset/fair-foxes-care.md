---
"ctx7": patch
---

Add CLI update notifications and a new `ctx7 upgrade` command. The CLI now checks for newer versions with cached state, shows a non-blocking notice before interactive commands, and provides safer upgrade guidance across npm, pnpm, bun, and ephemeral runner setups.
