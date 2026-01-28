# Changelog

## 0.2.0

### Features
- AI-powered skill generation with `skills generate` command
- Library search and selection with project ID disambiguation
- Clarifying questions to focus generated skills
- Real-time query progress display with documentation snippets
- Feedback loop for iterating on generated skills
- Weekly generation quota management (free: 6, pro: 10)
- OAuth 2.0 authentication with `login`, `logout`, and `whoami` commands

### Improvements
- Simplify `skills list` command to show all detected IDE skill directories without prompts

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
