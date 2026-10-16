---
"ctx7": minor
---

Tell users when their Context7 session has expired instead of silently continuing without an account. If the server rejects the stored refresh token, the CLI clears the dead credentials. In a terminal it asks "Your Context7 session has expired. Sign in again now? (Y/n)" and, on yes, signs you in and continues the command. In scripts, agents, CI or with `--json` it never prompts; it prints a one-line notice to stderr and continues anonymously. Network errors, rate limits and server errors keep the credentials so the next command retries.
