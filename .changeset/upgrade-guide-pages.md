---
"@upstash/context7-mcp": minor
---

Add a `page` argument to the `get-upgrade-guide` research preview tool: a long guide now comes in pages, each in full detail. Page 1 starts with everything needed to migrate (summary, before you start, codemods, breaking changes, deprecations), which continues on the next pages when it is longer than one page; behavior, config and API changes follow. A guide is served only once it is complete, so its pages always fit together; until then the tool says it is being prepared and when to call again, or that it could not be prepared.
