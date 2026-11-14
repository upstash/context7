---
"ctx7": patch
---

Strip terminal control characters from crowdsourced API content (library titles, descriptions, docs, code, upgrade guides and search results) before printing, preventing ANSI/OSC escape sequence injection in `ctx7` output. Reported by Syed Anas Mohiuddin.
