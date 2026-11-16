---
"ctx7": patch
---

`ctx7 login` and `ctx7 whoami` no longer hang on a stalled host: the identity check times out after 30 s, and an OAuth answer whose body stalls after the headers ends with the same clear timeout message as a stalled connection.
