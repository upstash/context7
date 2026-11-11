---
"ctx7": minor
---

`ctx7 code` waits up to 90 s while a version's source is indexed for the first time, and calls again by itself, before it exits with code 75. `--wait <seconds>` changes the wait; `--wait 0` exits at once as before.
