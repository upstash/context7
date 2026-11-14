---
"ctx7": patch
---

`ctx7 setup --antigravity` now installs skills where Antigravity looks for them: `~/.gemini/config/skills` globally and `.agents/skills` in a project. It previously wrote to `~/.agent/skills`, which Antigravity does not read, and to the legacy `.agent/skills` project folder.
