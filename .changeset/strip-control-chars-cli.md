---
"ctx7": patch
---

Strip terminal control characters from crowdsourced API content (library titles, descriptions, docs) before printing, preventing ANSI/OSC escape sequence injection in `ctx7 docs` and `ctx7 library` output. Reported by Syed Anas Mohiuddin.
