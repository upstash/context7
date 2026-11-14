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
ctx7 setup --vscode
ctx7 setup --devin
ctx7 setup --copilot
ctx7 setup --pi
ctx7 setup --t3
```

T3 Code uses its providers’ configuration. `ctx7 setup --t3` configures both Claude Code
and Codex; use `--claude` or `--codex` to configure just one. This also affects those
providers outside T3 Code. `ctx7 remove --t3` removes their Context7 setup. Both
commands support `--project`, `--mcp`, and `--cli`. Restart the provider session
in T3 Code after setup.

### Library Documentation

```bash
# Search documentation in one request
ctx7 search "how to stream an OpenAI response from a Next.js route"

# Narrow the search to libraries you already know
ctx7 search "how to stream a response" --library Next.js --library OpenAI

# Find a library
ctx7 library react
ctx7 library nextjs "app router"

# Get documentation
ctx7 docs /reactjs/react.dev "useEffect cleanup"
ctx7 docs /vercel/next.js "proxy"
```

## Usage

### Search documentation

Ask a question and get the best snippets from all libraries in one step. No library ID is needed.

```bash
ctx7 search "how do I validate a request body with a schema?"

# Search specific libraries: a name or a library ID, repeat for up to four
ctx7 search "how do I stream a response?" --library Next.js --library /openai/openai-node

# Search a specific version
ctx7 search "how do I cache a server function?" --library Next.js --library-version 15.4.0

# Prefer results in the language you write in
ctx7 search "how do I send an SMS?" --library Twilio --language Ruby

# Output as JSON
ctx7 search "how do I use hooks?" --library React --json
```

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
ctx7 docs /reactjs/react.dev "useEffect cleanup"
ctx7 docs /vercel/next.js "proxy authentication"
ctx7 docs /prisma/prisma "one-to-many relations"

# Output as JSON
ctx7 docs /reactjs/react.dev "hooks" --json
```

### Query source code

Search and read a library's source code at the version its docs describe. Search works like ripgrep.

```bash
ctx7 code /tanstack/query "invalidateQueries\\(" -g "packages/query-core/**"
ctx7 code /pydantic/pydantic "Input should be a valid integer" -F
ctx7 code /tokio-rs/tokio JoinHandle -c
ctx7 code /colinhacks/zod/v3.24.2 ZodEffects --op definition
ctx7 code /tokio-rs/tokio spawn --op read
ctx7 code /tanstack/query --op list --path packages/query-core/src
```

`--op` is `grep` (default), `definition`, `references`, `outline`, `read` or `list`. The search flags are `-F`, `-i`, `-g` (repeat it for more globs), `-C`, `-l`, `-c`, `--head-limit` and `--offset`. Add a git tag to the library ID (`/colinhacks/zod/v3.24.2`) or pass `--tag` for a version. The first query for a library version can answer that the source is still being indexed. Run the command again after the time it gives.

Get what changes when a library moves from one version to another: breaking changes, codemods, deprecations, behavior and config changes from the release notes of every release in between, and the public API changes found in the source code.

```bash
ctx7 get-upgrade-guide /vercel/next.js 14 16
ctx7 get-upgrade-guide /colinhacks/zod 3.24.2
ctx7 get-upgrade-guide /vercel/next.js 14 16 --page 2
```

A bare major such as `14` means the oldest release of that line as the start and the newest as the target. Without a target version, the guide goes to the latest major. A long guide comes in pages; page 1 starts with what is needed to migrate and says what the next pages hold. The first request for a pair of versions can take a few minutes while the guide is prepared: the command then exits with code 75 and says when to run it again. Guides are prepared for the most used libraries; for any other library the command says that its guide is not prepared yet.

### Setup

Configure Context7 MCP and a rule for your AI coding agents. Authenticates via OAuth, generates an API key, and writes the config.

```bash
# Interactive (prompts for agent selection)
ctx7 setup

# Target specific agents
ctx7 setup --cursor
ctx7 setup --claude
ctx7 setup --opencode
ctx7 setup --vscode
ctx7 setup --devin
ctx7 setup --copilot
ctx7 setup --pi

# Use an existing API key instead of OAuth
ctx7 setup --api-key YOUR_API_KEY

# Use OAuth endpoint (IDE handles auth flow)
ctx7 setup --oauth

# Configure an on-premise deployment (pass the deployment root)
ctx7 setup --mcp --base-url https://context7.internal.example --codex

# When on-premise MCP auth is enabled, the CLI prompts for the key with hidden input
ctx7 setup --mcp \
  --base-url https://context7.internal.example \
  --codex

# For non-interactive automation, provide the key through the environment
CONTEXT7_API_KEY=ctx7op-... ctx7 setup --mcp --yes \
  --base-url https://context7.internal.example \
  --codex

# Configure for current project only (default is global)
ctx7 setup --project

# Skip prompts
ctx7 setup --yes
```

For a custom `--base-url`, setup discovers whether MCP authentication is enabled and writes either an anonymous HTTP entry or an `Authorization: Bearer` header. Interactive setup requests the personal key with masked input, keeping it out of shell history; `--api-key` and `CONTEXT7_API_KEY` remain available for automation. Setup uses bundled rule and skill content and skips the npm update check and telemetry, so after `ctx7` is installed it contacts only the configured deployment. Enterprise environments can mirror `ctx7` and its dependencies in an internal npm registry. Custom deployments support MCP HTTP setup; hosted OAuth, stdio, and CLI-query mode are not supported for on-premise targets.

### Uninstall setup

Remove the Context7 setup written by `ctx7 setup`. By default this removes both MCP setup and CLI setup for the selected agent.

```bash
# Interactive
ctx7 remove

# Target specific agents
ctx7 remove --cursor
ctx7 remove --claude --project
ctx7 remove --vscode --project
ctx7 remove --devin --project
ctx7 remove --copilot --project
ctx7 remove --pi --project

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

The CLI automatically detects which AI coding agents you have installed and configures Context7 for them:

| Client                                                              | Skills Directory  |
| ------------------------------------------------------------------- | ----------------- |
| Universal (Amp, Codex, Gemini CLI, GitHub Copilot, OpenCode + more) | `.agents/skills/` |
| Claude Code                                                         | `.claude/skills/` |
| Cursor                                                              | `.cursor/skills/` |
| VS Code                                                             | `.agents/skills/` |
| Devin                                                               | `.devin/skills/`  |
| GitHub Copilot CLI                                                  | `.agents/skills/` |
| Antigravity                                                         | `.agents/skills/` |

## Disabling Telemetry

The CLI collects anonymous usage data to help improve the product. To disable telemetry, set the `CTX7_TELEMETRY_DISABLED` environment variable:

```bash
# For a single command
CTX7_TELEMETRY_DISABLED=1 ctx7 docs /reactjs/react.dev "useEffect examples"

# Or export in your shell profile (~/.bashrc, ~/.zshrc, etc.)
export CTX7_TELEMETRY_DISABLED=1
```

## Learn More

Visit [context7.com](https://context7.com) for documentation lookup and setup guides.
