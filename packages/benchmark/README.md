# @upstash/benchmark

Benchmarks Context7 trigger accuracy across different integration modes. Runs eval queries via `claude -p` and measures recall, precision, and false positives.

## Usage

```bash
# from repo root
pnpm bench

# specific modes
pnpm bench -- --modes mcp:prod,mcp:dev
pnpm bench -- --modes cli:prod,cli:dev

# custom options
pnpm bench -- --modes mcp:prod --workers 10 --model claude-sonnet-4-6
```

## Modes

| Mode | MCP server | Rule source | Skill source | Purpose |
|------|-----------|-------------|--------------|---------|
| `mcp:prod` | npm latest | master | - | MCP prod baseline |
| `mcp:dev` | local build | working tree | - | Test MCP changes |
| `cli:prod` | - | master | master | CLI prod baseline |
| `cli:dev` | - | working tree | working tree | Test CLI changes |

Ad-hoc modes for isolated testing: `mcp`, `mcp+rule`, `mcp+claude.md`, `cli+skill`, `cli+rule`, `cli+claude.md`

## Options

| Flag | Default | Description |
|------|---------|-------------|
| `--modes` | `mcp:prod,mcp:dev,cli:prod,cli:dev` | Comma-separated modes |
| `--model` | `claude-opus-4-6` | Claude model |
| `--workers` | `60` | Concurrent queries |
| `--max-turns` | `10` | Max turns per query |
| `--timeout` | `120` | Seconds per query |
| `--auth-mode` | `default` | `default` or `api-key` |
| `--with-context` | off | Prepend mid-session context |
| `--compare` | off | Run clean + with-context side by side |
