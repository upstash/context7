---
"@upstash/context7-mcp": patch
---

The server instructions now tell the agent to call Context7 before it writes any answer with code, configuration, or commands from a third-party library, tool, or service. They list the cases that agents often answer from memory and name no specific libraries. `resolve-library-id` and `query-docs` now set `_meta["anthropic/alwaysLoad"]`, so Claude Code loads them up front instead of deferring them behind tool search.
