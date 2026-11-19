---
"ctx7": minor
---

Add `--vscode-insiders` to `ctx7 setup` and `ctx7 remove`. Global setup now writes to the VS Code Insiders user folder, and you can combine it with `--vscode` in one command. The setup picker and auto-detection do not list VS Code Insiders, so use the flag.

`ctx7 remove` no longer deletes a skill from a shared skills folder (such as `~/.agents/skills`) while another agent still uses it.
