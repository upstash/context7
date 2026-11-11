---
"ctx7": patch
---

`ctx7` API calls now time out instead of hanging on a stalled connection: `ctx7 code` after 70 s (the server waits up to 40 s for a first index), the other commands after 60 s. A timeout prints a clear error and exits 1.
