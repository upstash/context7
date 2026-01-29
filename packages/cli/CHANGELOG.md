# Changelog

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
