---
"ctx7": patch
---

Read the GitHub CLI auth token by invoking `gh` directly instead of through a shell. The shell wrapper (`cmd.exe /d /s /c` on Windows) caused endpoint protection tools such as Microsoft Defender for Endpoint to raise a "Suspicious Node.js process behavior" alert during `ctx7 setup`.
