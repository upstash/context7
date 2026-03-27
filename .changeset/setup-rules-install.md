---
"ctx7": patch
---

Install rules alongside skills in `ctx7 setup` for better trigger rates

- CLI setup now installs a rule file for each agent (previously only installed the skill)
- Rule content fetched from GitHub, with agent-specific formatting (alwaysApply for Cursor)
- Updated find-docs skill description for higher invocation rates (66% -> 98%)
- Added Codex agent support with AGENTS.md append
- OpenCode now writes to AGENTS.md instead of .opencode/rules/
- Selective rule content with explicit when-to-use/when-not-to-use guidance
