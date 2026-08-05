---
"ctx7": minor
---

Store CLI credentials in the system keyring when available, with automatic migration from plaintext JSON and a JSON fallback for headless environments. Supports `CTX7_CREDENTIAL_STORE=auto|json|keyring`.

Fixes #2639
