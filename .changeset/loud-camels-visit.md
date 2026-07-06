---
"@upstash/context7-mcp": patch
---

Skip loopback (`127.0.0.0/8`), link-local (`169.254.0.0/16`), CGNAT (`100.64.0.0/10`), IPv6 loopback (`::1`), IPv6 link-local (`fe80::/10`), and IPv6 unique-local (`fc00::/7`) addresses when extracting the client IP from `X-Forwarded-For`, so proxy-internal hops no longer pollute the reported client IP.
