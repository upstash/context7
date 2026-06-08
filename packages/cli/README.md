# ctx7

CLI for [Context7](https://context7.com) - query up-to-date library documentation and configure Context7 for AI coding agents.

## Installation

```bash
# Run directly with npx (no install needed)
npx ctx7

# Or install globally
npm install -g ctx7
```

## Quick Start

```bash
# Set up Context7 MCP for your coding agents
ctx7 setup

# Remove Context7 setup later
ctx7 remove

# Target a specific agent
ctx7 setup --cursor
ctx7 setup --claude
ctx7 setup --opencode
```

### Library Documentation

```bash
# Find a library
ctx7 library react
ctx7 library nextjs "app router"

# Get documentation
ctx7 docs /facebook/react "useEffect cleanup"
ctx7 docs /vercel/next.js "middleware"
```

## Usage

### Find a library

Resolve a library name to a Context7 library ID.

```bash
ctx7 library react
ctx7 library nextjs "app router setup"
ctx7 library prisma "database relations"

# Output as JSON
ctx7 library react --json
```

### Query documentation

Fetch documentation for a specific library using its Context7 ID.

```bash
ctx7 docs /facebook/react "useEffect cleanup"
ctx7 docs /vercel/next.js "middleware authentication"
ctx7 docs /prisma/prisma "one-to-many relations"

# Output as JSON
ctx7 docs /facebook/react "hooks" --json
```

### Setup

Configure Context7 MCP and a rule for your AI coding agents. Authenticates via OAuth, generates an API key, and writes the config.

```bash
# Interactive (prompts for agent selection)
ctx7 setup

# Target specific agents
ctx7 setup --cursor
ctx7 setup --claude
ctx7 setup --opencode

# Use an existing API key instead of OAuth
ctx7 setup --api-key YOUR_API_KEY

# Use OAuth endpoint (IDE handles auth flow)
ctx7 setup --oauth

# Configure for current project only (default is global)
ctx7 setup --project

# Skip prompts
ctx7 setup --yes
```

### Uninstall setup

Remove the Context7 setup written by `ctx7 setup`. By default this removes both MCP setup and CLI setup for the selected agent.

```bash
# Interactive
ctx7 remove

# Target specific agents
ctx7 remove --cursor
ctx7 remove --claude --project

# Remove both setup modes explicitly
ctx7 remove --cursor --all

# Remove only one setup mode
ctx7 remove --cursor --cli
ctx7 remove --claude --mcp
```

If you installed the CLI itself globally with `npm install -g ctx7`, remove that separately with `npm uninstall -g ctx7`. If you use `npx ctx7`, there is no permanent CLI install to remove.

### Authentication

Log in to access authenticated setup and higher documentation rate limits.

```bash
# Log in (opens browser for OAuth)
ctx7 login

# Check login status
ctx7 whoami

# Log out
ctx7 logout
```

## Supported Clients

The CLI automatically detects which AI coding assistants you have installed and configures Context7 for them:

| Client                                                              | Skills Directory  |
| ------------------------------------------------------------------- | ----------------- |
| Universal (Amp, Codex, Gemini CLI, GitHub Copilot, OpenCode + more) | `.agents/skills/` |
| Claude Code                                                         | `.claude/skills/` |
| Cursor                                                              | `.cursor/skills/` |
| Antigravity                                                         | `.agent/skills/`  |

## Disabling Telemetry

The CLI collects anonymous usage data to help improve the product. To disable telemetry, set the `CTX7_TELEMETRY_DISABLED` environment variable:

```bash
# For a single command
CTX7_TELEMETRY_DISABLED=1 ctx7 docs /facebook/react "useEffect examples"

# Or export in your shell profile (~/.bashrc, ~/.zshrc, etc.)
export CTX7_TELEMETRY_DISABLED=1
```

## Learn More

Visit [context7.com](https://context7.com) for documentation lookup and setup guides.
