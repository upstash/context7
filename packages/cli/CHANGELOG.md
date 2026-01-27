# Changelog

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
