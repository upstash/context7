# Windows packaging (winget)

Context7 CLI is published to npm as [`ctx7`](https://www.npmjs.com/package/ctx7) and already available via Homebrew (`brew install ctx7`). Windows users historically had to use Node/`npx`.

## Portable zip + WinGet

This package ships:

- `packages/cli/scripts/build-win-portable.mjs` — builds `context7-<version>-win-portable.zip`
- `packages/cli/packaging/winget/` — WinGet manifest templates (`Upstash.Context7`)
- `.github/workflows/cli-portable-release.yml` — builds the zip and optionally submits to [microsoft/winget-pkgs](https://github.com/microsoft/winget-pkgs)

The portable package depends on **Node.js LTS** (`OpenJS.NodeJS.LTS`) and exposes both `context7` and `ctx7` commands.

### Maintainer checklist

1. Publish the CLI via the existing changesets/npm release flow.
2. Create a GitHub Release (or run **CLI portable release** via `workflow_dispatch`) so the portable zip is attached.
3. Set repository secret `WINGET_TOKEN` (classic PAT that can open PRs against a fork of `microsoft/winget-pkgs`) to enable automatic WinGet submission.
4. Verify: `winget install Upstash.Context7` then `context7 --version` / `ctx7 --version`.

Until the first WinGet package lands, Windows users can still:

```powershell
npm install -g ctx7
context7 --help
```
