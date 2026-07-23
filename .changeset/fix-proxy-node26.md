---
"@upstash/context7-mcp": patch
---

Bump `undici` to 7 and require Node.js >= 20.18.1. On Node 26+ (internal undici 8) the bundled undici 6 `setGlobalDispatcher` wrote a global-dispatcher symbol the built-in `fetch` no longer reads, so `HTTPS_PROXY` and custom-CA settings were silently ignored and requests failed with `ENOTFOUND` behind CONNECT proxies. undici 7 writes both symbols, restoring proxy and CA support. Node 18 is no longer supported (EOL; undici 7 requires Node >= 20.18.1).
