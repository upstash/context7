---
"ctx7": patch
---

Surface the underlying network error when an OAuth request fails. Connection failures now report the cause (TLS interception, DNS, firewall, timeout) with a hint, and non-JSON error responses report the HTTP status and body excerpt instead of a generic message.
