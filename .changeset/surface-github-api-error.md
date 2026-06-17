---
"ctx7": patch
---

Surface the real GitHub status when skill downloads fail. A bare "GitHub API error" now becomes an actionable message distinguishing 401 (invalid/expired token), 403 (rate limit), and 404 (repo/branch not found), and setup prints a `tip:` line telling users to refresh GITHUB_TOKEN/GH_TOKEN or run `gh auth login`, so an expired token is no longer mistaken for a rate limit.
