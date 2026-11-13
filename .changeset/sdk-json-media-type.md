---
"@upstash/context7-sdk": patch
---

Recognize JSON response media types case-insensitively and match the complete type before parameters using HTTP whitespace. JSON successes and malformed JSON errors now work with mixed-case types; text types that only contain "application/json" and invalid types containing non-HTTP whitespace are handled as text.
