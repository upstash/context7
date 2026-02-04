---
"ctx7": minor
---

Add automatic skill suggestions after package installation

- Add `--detect-new` flag to `ctx7 skills suggest` for detecting newly installed packages
- Automatically run skill detection via postinstall hook
- Cache pending packages in `node_modules/.cache/context7` for later interactive installation
- Support both pnpm (node_modules comparison) and npm (lockfile comparison) package managers
