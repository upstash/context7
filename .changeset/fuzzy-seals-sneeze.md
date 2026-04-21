---
"ctx7": patch
---

Add `ctx7 remove` as the cleanup counterpart to `ctx7 setup`, with safer detection and removal behavior. The command now prompts only for agents with actual Context7 artifacts, preserves non-Context7 MCP configuration when removing entries, and includes stronger test coverage for JSON and TOML cleanup.
