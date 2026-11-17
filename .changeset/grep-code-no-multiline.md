---
"@upstash/context7-mcp": patch
---

`grep-code` no longer offers `multiline`: a multiline search over a whole repository timed out. An agent that still sends it is told to search one line and read the lines around it with `read-code`.
