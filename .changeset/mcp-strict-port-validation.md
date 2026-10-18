---
"@upstash/context7-mcp": patch
---

Validate `--port` with commander's own argument parser: 0 (let the OS pick an ephemeral port) through 65535 are accepted, anything else is rejected with commander's standard `error: option '--port <number>' argument '…' is invalid` message. The port-in-use retry now stops at 65535 instead of calling `listen(65536)` and crashing the process.
