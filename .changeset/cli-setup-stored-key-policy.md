---
"ctx7": patch
---

`ctx7 setup` checks an API key saved by an earlier login before it writes it, and continues with OAuth when the teamspace's policy now refuses that key, instead of configuring a key that fails on every call.
