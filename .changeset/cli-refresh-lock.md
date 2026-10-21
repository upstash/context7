---
"ctx7": patch
---

Keep you signed in when several ctx7 commands run at once on an expired session. Each command used to refresh the token on its own, and two refreshes with the same token made the server revoke the whole session. Refreshes now take a lock file next to the credentials file: the first command refreshes and writes the new credentials, and the others wait for it and read them. A running command keeps its lock fresh, so a slow refresh is waited for, while a lock left behind by a crashed command is ignored after ten seconds and no command hangs on it. If the lock cannot be taken, for example on a read-only home directory, the command refreshes as before.
