---
"ctx7": patch
---

Surface the real GitHub status when skill downloads fail. A bare "GitHub API error" now becomes an actionable message distinguishing 401 (invalid/expired token), 403 (rate limit), and 404 (repo/branch not found), so users can tell an expired GITHUB_TOKEN/GH_TOKEN apart from a rate limit.
