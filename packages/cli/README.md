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

# Generate a custom skill with AI
ctx7 skills generate

# List installed skills
ctx7 skills list --claude
```

## Usage

### Generate skills

Generate custom skills tailored to your use case using AI. Requires authentication.

```bash
# Log in first
ctx7 login

# Generate a skill (interactive)
ctx7 skills generate

# Short aliases
ctx7 skills gen
ctx7 skills g

# Generate and install to a specific client
ctx7 skills generate --cursor
ctx7 skills generate --claude

# Generate globally
ctx7 skills generate --global
```

The generate flow:

1. Describe the expertise you want (e.g., "OAuth authentication with NextAuth.js")
2. Select relevant libraries from search results
3. Answer 3 clarifying questions to focus the skill
4. Review the generated skill, request changes if needed, then install

Weekly generation limits apply: free accounts get 6 generations/week, Pro accounts get 10.

### Authentication

Log in to access skill generation and other authenticated features.

```bash
# Log in (opens browser for OAuth)
ctx7 login

# Check login status
ctx7 whoami

# Log out
ctx7 logout
```

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
ctx7 skills gen                   # skills generate
ctx7 skills g                     # skills generate
```

## Disabling Telemetry

The CLI collects anonymous usage data to help improve the product. To disable telemetry, set the `CTX7_TELEMETRY_DISABLED` environment variable:

```bash
# For a single command
CTX7_TELEMETRY_DISABLED=1 ctx7 skills search pdf

# Or export in your shell profile (~/.bashrc, ~/.zshrc, etc.)
export CTX7_TELEMETRY_DISABLED=1
```

## Learn More

Visit [context7.com](https://context7.com) to browse the skills registry and discover available skills.
