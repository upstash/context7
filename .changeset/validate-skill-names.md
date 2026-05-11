---
"ctx7": patch
---

Harden skill name handling during `ctx7 skills install` and `ctx7 skills remove`. Skill names from remote `SKILL.md` files are now restricted to a safe character set, and the install sinks assert the target directory is a direct child of the skills root before writing.
