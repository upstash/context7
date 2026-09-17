---
"ctx7": patch
---

Use the shared API URL for login and explain how to sign in again when the server rejects a saved session.

Recommend logout and login only when the server returns HTTP 401. Report other identity-check failures without asking users to discard saved credentials.
