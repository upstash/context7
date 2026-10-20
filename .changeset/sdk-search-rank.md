---
"@upstash/context7-sdk": minor
---

`search()` JSON results now type the `rank` field on each code and info snippet: the snippet's 1-based place in the reranked order shared by both lists. Sort `codeSnippets` and `infoSnippets` together by `rank` to read the results in the order the text response gives them.
