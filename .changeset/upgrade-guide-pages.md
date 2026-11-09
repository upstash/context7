---
"@upstash/context7-mcp": minor
---

Add `page` and `guideHash` arguments to the `get-upgrade-guide` research preview tool: a long guide now comes in pages, each in full detail. Page 1 starts with everything needed to migrate (summary, before you start, codemods, breaking changes, deprecations), which continues on the next pages when it is longer than one page; behavior, config and API changes follow. `guideHash` keeps later pages on the version of the guide the agent started reading.
