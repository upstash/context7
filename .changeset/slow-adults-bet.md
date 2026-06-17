---
"ctx7": patch
---

Surface GitHub API error details when skill download fails (#2363)

Previously, any GitHub API failure during `ctx7 setup` or `ctx7 setup --cli` produced the opaque message "GitHub API error", making it impossible to distinguish a 403 rate-limit from a 401 bad token or a 404 wrong branch.

Changes:
- `fetchRepoTree` and `fetchDefaultBranch` now extract the HTTP status and GitHub error body, returning descriptive strings like `"HTTP 403: API rate limit exceeded"`
- `listSkillsFromGitHub` distinguishes a true 404 (repo not found) from other errors (rate-limit, bad credentials) that previously all collapsed into the same silent result
- When a request fails unauthenticated with a 403/429, a hint is shown: `run \`gh auth login\` or set the GITHUB_TOKEN env var to increase rate limits`
- Failed skill entries in the setup results table now show a red `✖` with the error detail on its own line instead of embedding it in the status string
