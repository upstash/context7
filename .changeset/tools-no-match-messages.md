---
"@upstash/context7-tools-ai-sdk": patch
---

`resolveLibraryId` returns the SDK's "No libraries found" message when nothing matches, and `queryDocs` returns its "No documentation found" message for an unknown library ID. Other errors no longer end with ".. Check your API key and try again."
