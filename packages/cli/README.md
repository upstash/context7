# ctx7

CLI for the [Context7 Skills Registry](https://context7.com) - install and manage AI coding skills across different AI coding assistants.

Skills are reusable prompt instructions that enhance your AI coding assistant with specialized capabilities like working with specific frameworks, libraries, or coding patterns.

## Installation

```bash
# Run directly with npx (no install needed)
npx ctx7

# Or install globally
npm install -g ctx7
```

## Quick Start

```bash
# Search for skills
ctx7 skills search pdf

# Install a skill
ctx7 skills install /anthropics/skills pdf

# List installed skills
ctx7 skills list --claude
```

## Usage

### Install skills

Install skills from a project repository to your AI coding assistant's skills directory.

```bash
# Install all skills from a project (interactive selection)
ctx7 skills install /anthropics/skills

# Install a specific skill
ctx7 skills install /anthropics/skills pdf

# Install multiple skills at once
ctx7 skills install /anthropics/skills pdf commit

# Install to a specific client
ctx7 skills install /anthropics/skills pdf --cursor
ctx7 skills install /anthropics/skills pdf --claude

# Install globally (home directory instead of current project)
ctx7 skills install /anthropics/skills pdf --global
```

### Search for skills

Find skills across all indexed projects in the registry.

```bash
ctx7 skills search pdf
ctx7 skills search typescript
ctx7 skills search react testing
```

### List installed skills

View skills installed in your project or globally.

```bash
ctx7 skills list
ctx7 skills list --claude
ctx7 skills list --cursor
ctx7 skills list --global
```

### Show skill information

Get details about available skills in a project.

```bash
ctx7 skills info /anthropics/skills
```

### Remove a skill

Uninstall a skill from your project.

```bash
ctx7 skills remove pdf
ctx7 skills remove pdf --claude
ctx7 skills remove pdf --global
```

## Supported Clients

The CLI automatically detects which AI coding assistants you have installed and offers to install skills for them:

| Client | Skills Directory |
|--------|-----------------|
| Claude Code | `.claude/skills/` |
| Cursor | `.cursor/skills/` |
| Codex | `.codex/skills/` |
| OpenCode | `.opencode/skills/` |
| Amp | `.agents/skills/` |
| Antigravity | `.agent/skills/` |

## Shortcuts

For faster usage, the CLI provides short aliases:

```bash
ctx7 si /anthropics/skills pdf   # skills install
ctx7 ss pdf                       # skills search
```

## Learn More

Visit [context7.com](https://context7.com) to browse the skills registry and discover available skills.
