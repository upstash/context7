# Changelog

## 0.5.4

### Patch Changes

- 33229cb: Clarify the `query-docs` query description so it asks for a single concept per query. When a question spans multiple distinct topics, callers are now told to make a separate query per concept instead of combining them (unless the question is about how the concepts interact), which avoids diluted, shallow results. Applied consistently across the MCP server, CLI, pi, and AI SDK tools.

## 0.5.3

### Patch Changes

- acd0d46: Surface GitHub API error details when skill download fails (#2363)

  Previously, any GitHub API failure during `ctx7 setup` or `ctx7 setup --cli` produced the opaque message "GitHub API error", making it impossible to distinguish a 403 rate-limit from a 401 bad token or a 404 wrong branch.

  Changes:
  - `fetchRepoTree` and `fetchDefaultBranch` now extract the HTTP status and GitHub error body, returning descriptive strings like `"HTTP 403: API rate limit exceeded"`
  - `listSkillsFromGitHub` distinguishes a true 404 (repo not found) from other errors (rate-limit, bad credentials) that previously all collapsed into the same silent result
  - When a request fails unauthenticated with a 403/429, a hint is shown: `run \`gh auth login\` or set the GITHUB_TOKEN env var to increase rate limits`
  - Failed skill entries in the setup results table now show a red `✖` with the error detail on its own line instead of embedding it in the status string

## 0.5.2

### Patch Changes

- cb6aee1: Bump runtime dependencies: `commander` 13 -> 15 and `ora` 9.0 -> 9.4.
- 428af3e: Recover Context7 library IDs that Git Bash mangles on Windows. Git Bash rewrites a leading-slash argument like `/facebook/react` into a Windows path under the Git install dir (`C:/Program Files/Git/facebook/react`), causing `ctx7 docs` to reject it as invalid; this mainly affected users running ctx7 through Claude Code. The CLI now detects and undoes the conversion before validation, accepts the `//owner/repo` escape, and points users at that workaround for install layouts it can't auto-detect.
- c03bc9c: Store CLI files in XDG Base Directory locations instead of `~/.context7`. Credentials move to `$XDG_CONFIG_HOME/context7` (default `~/.config/context7`), updater state to `$XDG_STATE_HOME/context7` (default `~/.local/state/context7`), and `generate` previews to `$XDG_CACHE_HOME/context7` (default `~/.cache/context7`). Existing files in `~/.context7` are migrated automatically on first use; migration is best-effort and falls back to reading the legacy file if it cannot complete. The credentials file is always re-asserted to `0o600` after migration or write so it is never group/world-readable. Relative or empty `XDG_*` values are ignored per the spec.

## 0.5.1

### Patch Changes

- ea91d7d: `ctx7 login` now always uses the device-code flow. The localhost-callback path is removed — every install (laptop, SSH, Codespace, Docker, CI) goes through the same boxed prompt and verification page. Drops the `--device` flag (it was the opt-in for what's now the default). Older CLI versions (≤ 0.5.0) continue to work against the unchanged auth endpoints, so pinned installs are unaffected.

## 0.5.0

### Minor Changes

- 5a180d5: Add OAuth 2.0 device authorization flow (RFC 8628) for `ctx7 login` and `ctx7 setup`. Required for headless / remote hosts (SSH, Codespaces, Docker, CI) where the existing localhost-callback flow can't work — the browser was opening on the user's laptop while the callback listener ran on the remote host.

  The new flow prints a verification URL and short code, then polls a token endpoint. The user visits the URL on any device, signs in, and approves; the CLI receives the same `ctx7sk-…` API key it would have gotten from the legacy flow. Device flow is selected automatically when `SSH_CONNECTION` is set or `$DISPLAY` is missing on Linux, and can be forced with `ctx7 login --device`. Polling tolerates transient network errors and 5xx responses without ending the session.

## 0.4.5

### Patch Changes

- 2affada: `ctx7 setup` now properly supports `--antigravity`, installing skills to `.agent/skills`, a `GEMINI.md` rule section (Antigravity reads Gemini-family config), and MCP config to Antigravity 2.0's documented global path `~/.gemini/config/mcp_config.json` (with `httpUrl` for HTTP, matching the Gemini convention). Antigravity has no documented project-level MCP file, so `setup --antigravity --project --mcp` writes to the global location. Also removes the `--universal` flag from `setup`, which was advertised but silently ignored — it never propagated through agent selection, so passing it (e.g. `setup --cli --universal --project`) caused setup to fall back to auto-detection and write to the wrong directory.
- 268f52f: `ctx7 setup --api-key <KEY>` (without `--cli`, `--mcp`, or `-y`) now prompts to choose between MCP server and CLI + Skills modes. Previously, passing `--api-key` short-circuited to MCP, locking users out of the CLI + Skills option even though that mode also accepts an API key. Explicit `--mcp` / `--cli` / `--stdio` / `--oauth` / `-y` still skip the prompt as before.
- 2e97dae: Add deprecation warning to skill commands

## 0.4.4

### Patch Changes

- 7cacc94: Add `--json` flag to `ctx7 skills list` for machine-parseable output. Emits `{ skills: [{ name, path, source }] }` where `path` is absolute and `source` is the agent type (`universal`, `claude`, `cursor`, `antigravity`). Matches the existing `--json` pattern on `ctx7 library` and `ctx7 docs`.

## 0.4.3

### Patch Changes

- dea0e43: Declare `@inquirer/core` as a direct dependency of the CLI. It was previously imported in `selectOrInput.ts` but only resolvable as a transitive of `@inquirer/prompts`, which caused `ctx7` to fail at startup with `ERR_MODULE_NOT_FOUND` under pnpm's isolated node linker.
- 34fda7d: Add `--stdio` flag to `ctx7 setup` to configure Context7 as a local stdio MCP server.
- 61de754: Harden skill name handling during `ctx7 skills install` and `ctx7 skills remove`. Skill names from remote `SKILL.md` files are now restricted to a safe character set, and the install sinks assert the target directory is a direct child of the skills root before writing.

## 0.4.2

### Patch Changes

- 6c71e4d: Handle malformed MCP config files gracefully during `ctx7 remove` agent detection. Previously, an unparseable JSON config at any agent's well-known path (e.g. a hand-edited `~/.claude.json`) would crash the command with an unhandled `SyntaxError` before it could do anything. The detector now skips the offending file and logs a warning naming the path and parse error so the user can fix it, while detection continues for the remaining agents.
- 4056850: Respect `CLAUDE_CONFIG_DIR` env var when resolving Claude Code's global config, rules, skills, and detection paths

## 0.4.1

### Patch Changes

- 1aa3430: Remove research mode entirely from the MCP server and CLI. The `query-docs` MCP tool no longer accepts or forwards a `researchMode` parameter, and the CLI no longer exposes a `--research` flag on `ctx7 docs`.

## 0.4.0

### Minor Changes

- 17b864f: Expose research mode through the MCP `researchMode` tool and the CLI `docs --research` flag for deep, agent-driven documentation answers.

### Patch Changes

- 4feee15: Add CLI update notifications and a new `ctx7 upgrade` command. The CLI now checks for newer versions with cached state, shows a non-blocking notice before interactive commands, and provides safer upgrade guidance across npm, pnpm, bun, and ephemeral runner setups.
- f056b14: Add `ctx7 remove` as the cleanup counterpart to `ctx7 setup`, with safer detection and removal behavior. The command now prompts only for agents with actual Context7 artifacts, preserves non-Context7 MCP configuration when removing entries, and includes stronger test coverage for JSON and TOML cleanup.

## 0.3.13

### Patch Changes

- 3f6e310: Fix skill installation path validation on Windows so valid files inside the target directory are not rejected due to backslash-separated resolved paths.

## 0.3.12

### Patch Changes

- 33f2338: Add Codex-specific CLI setup guidance so generated rules and the installed `find-docs` skill tell Codex to rerun Context7 CLI requests outside the default sandbox after DNS or network failures.

## 0.3.11

### Patch Changes

- bc8eaf1: Add `--all-agents` and `--yes` support to `ctx7 skills install` for non-interactive multi-agent installs.

## 0.3.10

### Patch Changes

- fb29170: Add Gemini CLI support to setup command
- 89d4862: Use GITHUB_TOKEN/GH_TOKEN or gh CLI auth for skill downloads to avoid GitHub API rate limits and support private repos
- 8322879: Improve resolve libryar id tool prompt to provide the libraryName query with proper format

## 0.3.9

### Patch Changes

- 6961bdd: Allow re-selecting already configured agents in ctx7 setup and overwrite existing MCP config entries instead of skipping them. Fix TOML replacement to correctly handle sub-sections and prevent whitespace drift on repeated runs.

## 0.3.8

### Patch Changes

- a667712: Update search filter warning
- d739f9b: Fix OpenCode MCP setup to resolve all config file variants (opencode.json, opencode.jsonc, .opencode.json, .opencode.jsonc)
- 4f13168: Install rules alongside skills in `ctx7 setup` for better trigger rates
  - CLI setup now installs a rule file for each agent (previously only installed the skill)
  - Rule content fetched from GitHub, with agent-specific formatting (alwaysApply for Cursor)
  - Updated find-docs skill description for higher invocation rates (66% -> 98%)
  - Added Codex agent support with AGENTS.md append
  - OpenCode now writes to AGENTS.md instead of .opencode/rules/
  - Selective rule content with explicit when-to-use/when-not-to-use guidance

- c3c2647: Use ~/.agents/skills instead of ~/.config/agents/skills for global universal skill installs

## 0.3.7

### Patch Changes

- 93eaf54: Remove shell:true from spawn call in generate command to prevent command injection via EDITOR env variable
- 8c5cf7d: Prevent directory traversal in skill file installation by validating resolved paths stay within the target directory

## 0.3.6

### Patch Changes

- fae6127: Add active teamspace name to whoami command output
- 4b63117: Reorder setup mode choices to show MCP server first
- 18b3292: Add token refresh support, centralize auth constants, switch whoami to internal API endpoint with teamspace display, and add unit tests for CLI auth utilities and commands

## 0.3.5

### Patch Changes

- 7e60d05: - feat(cli): track install count events when skills are installed via `ctx7 setup`

## 0.3.4

### Patch Changes

- 62dc278: - feat(cli): enumerate popularity with a 4-star scale in skill search, install, and suggest results
  - feat(cli): show install count range and trust score in skill hover details
  - fix(cli): rename "docs" skill to "find-docs" in setup output and prompts
- 04130b5: Consolidate skills under /skills with canonical sources: rename docs→find-docs, ctx7-cli→context7-cli, add context7-mcp as canonical MCP skill. MCP setup now downloads skill from GitHub instead of using hardcoded content.
- d418405: Add CLI mode to ctx7 setup for installing the docs skill without MCP configuration

## 0.3.3

### Patch Changes

- 31b4fb8: Align CLI library output format with MCP: use labeled fields (Title, Context7-compatible library ID, Description, Code Snippets, Source Reputation, Benchmark Score, Versions) and categorical reputation labels (High/Medium/Low/Unknown) instead of numeric trust scores
- 9de3f06: Display warning when public library access filter is being used to filter libraries.
- 05a4406: Remove default selection of Universal agent target during skills install prompt
- 9aae852: Show source repository next to skill name in search and suggest results for easier disambiguation

## 0.3.2

### Patch Changes

- df60e3e: Add `library` and `docs` commands for querying library documentation from the terminal

## 0.3.1

### Patch Changes

- c66950a: Install documentation-lookup skill during `ctx7 setup`

## 0.3.0

### Minor Changes

- 3d66191: Add `ctx7 setup` command for configuring Context7 MCP and rules across Claude Code, Cursor, and OpenCode

## 0.2.4

### Patch Changes

- 4663c15: - Adopt `.agents/skills` as universal install target, supporting multiple agents with a single installation
  - Replace `--codex`, `--opencode`, and `--amp` flags with single `--universal` flag
  - Improve checkbox UI with aligned column headers for better readability

## 0.2.3

### Patch Changes

- 0981656: Add `skills suggest` command that scans your project's dependencies (package.json, requirements.txt, pyproject.toml) and recommends relevant skills. Results show install counts, trust scores, and which dependency each skill matches.

## 0.2.2

### Patch Changes

- 6328ed1: Skill search & generate command improvements:
  - Add "Installs" and "Trust(0-10)" columns to skill search results with aligned column headers
  - Auto-login via OAuth when the generate command requires authentication instead of showing an error
  - Reorder question options so the recommended choice always appears first with a "✓ Recommended" badge
  - Add "View skill" action that opens generated content in the user's default editor (`$EDITOR`)
  - Revamp generate wizard copy: do/don't examples for skill descriptions, rename "libraries" to "sources", and clarify follow-up question and generation spinner text

## 0.2.1

### Patch Changes

- 2f7cc42: Show exact install counts instead of rounded values, sort skills by install count in the install command, and display "installs" column header inline with the prompt
- 85b905e: Add CLI telemetry for usage metrics collection (commands, searches, installs, generation feedback) via fire-and-forget events to /api/v2/cli/events. Respects CTX7_TELEMETRY_DISABLED env var.

## 0.2.0

### Minor Changes

- 8ba484c: Add AI-powered skill generation with `skills generate` command, including library search, clarifying questions, real-time query progress, feedback loop, and weekly quota management.
- aacfd31: Add OAuth 2.0 authentication with login, logout, and whoami commands.

### Patch Changes

- 572c3ca: Simplify `skills list` command to show all detected IDE skill directories without prompts.

## 0.1.5

### Improvements

- Improved skill selection UX with metadata panel showing Skill, Repo, and Description
- Clickable links in metadata (Skill → context7.com, Repo → GitHub)
- Display install counts next to skill names (e.g., `↓100+`, `↓50+`)
- Numbered list items for easier reference
- Select hovered item on Enter without needing to Space-select first
- Green highlight for hovered row
- Fix circular scrolling - navigation now stops at list boundaries

## 0.1.4

- Add prompt injection detection with warning messages for blocked skills

## 0.1.3

- Auto-detect installed IDE configurations in project/global directories
- Add confirmation prompt before installing to detected locations

## 0.1.0

- Initial stable release
- Commands: `install`, `search`, `list`, `remove`, `info`
- Multi-IDE support: Claude, Cursor, Codex, OpenCode, Amp, Antigravity
- Global and project-level skill installation
- Symlink support (Claude gets original files, others get symlinks)
- Short aliases: `si`, `ss`
- Single skill installation via `ctx7 skills install /owner/repo skill-name`
- Installation tracking metrics
