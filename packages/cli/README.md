# ctx7

CLI for the Context7 Skills Registry - manage AI coding skills across different AI coding assistants.

## Installation

```bash
# Run directly with npx (no install needed)
npx ctx7

# Or install globally
npm install -g ctx7
```

## Usage

### Install skills

```bash
# Install all skills from a project
ctx7 skills install /owner/repo

# Install specific skills
ctx7 skills install /owner/repo skill-name

# Install to a specific client
ctx7 skills install /owner/repo --cursor
ctx7 skills install /owner/repo --claude

# Install globally (home directory)
ctx7 skills install /owner/repo --global
```

### Search for skills

```bash
ctx7 skills search <query>
```

### List installed skills

```bash
ctx7 skills list
ctx7 skills list --claude
ctx7 skills list --global
```

### Show skill information

```bash
ctx7 skills info /owner/repo
```

### Remove a skill

```bash
ctx7 skills remove <skill-name>
```

## Supported Clients

- Claude Code (`.claude/skills/`)
- Cursor (`.cursor/skills/`)
- Codex (`.codex/skills/`)
- OpenCode (`.opencode/skill/`)
- Amp (`.agents/skills/`)
- Antigravity (`.agent/skills/`)

## Shortcuts

```bash
ctx7 si /owner/repo      # skills install
ctx7 ss <query>          # skills search
```
