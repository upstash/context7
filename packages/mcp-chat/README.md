# Context7 Chat MCP Server

An MCP (Model Context Protocol) server that provides AI-powered answers about library documentation using Context7's documentation database.

## What it does

This MCP server exposes a single tool (`query-docs`) that allows LLMs to ask questions about any library and get formatted, up-to-date answers based on Context7's documentation database.

Unlike the main Context7 MCP server which retrieves raw documentation, this server returns AI-generated responses that directly answer your questions.

## Requirements

- Node.js >= v18.0.0
- Context7 API Key (required) - Get yours at [context7.com/dashboard](https://context7.com/dashboard)

## Usage

### Adding to Cursor

Add to your `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "context7-chat": {
      "command": "npx",
      "args": ["-y", "@upstash/context7-chat-mcp", "--api-key", "YOUR_API_KEY"]
    }
  }
}
```

### Adding to Claude Code

```bash
claude mcp add context7-chat -- npx -y @upstash/context7-chat-mcp --api-key YOUR_API_KEY
```

### Adding to VS Code

Add to your VS Code MCP settings:

```json
{
  "mcp": {
    "servers": {
      "context7-chat": {
        "type": "stdio",
        "command": "npx",
        "args": ["-y", "@upstash/context7-chat-mcp", "--api-key", "YOUR_API_KEY"]
      }
    }
  }
}
```

### Testing with MCP Inspector

```bash
npx @modelcontextprotocol/inspector npx -y @upstash/context7-chat-mcp --api-key YOUR_API_KEY
```

## Available Tools

### `query-docs`

Ask a question about any library and get an AI-powered answer.

**Parameters:**

| Parameter | Type   | Required | Description                                                     |
| --------- | ------ | -------- | --------------------------------------------------------------- |
| `query`   | string | Yes      | Your question about a library                                   |
| `library` | string | No       | Library to focus the search on (recommended for better results) |

**Examples:**

```txt
query: "How do I create a checkout session?"
library: "stripe"
```

```txt
query: "How to set up server-side rendering?"
library: "nextjs"
```

```txt
query: "What are React hooks and how do I use useState?"
```

## Configuration Options

| Option      | Description                                                                                      |
| ----------- | ------------------------------------------------------------------------------------------------ |
| `--api-key` | Your Context7 API key (required)                                                                 |
| `--model`   | OpenRouter model ID to use for generating responses (e.g., `google/gemini-2.5-flash`) (optional) |

### Environment Variables

| Variable           | Description                                             |
| ------------------ | ------------------------------------------------------- |
| `CONTEXT7_API_KEY` | Your Context7 API key (alternative to `--api-key` flag) |

### Using a Custom Model

You can specify which OpenRouter model to use for generating responses:

```bash
npx -y @upstash/context7-chat-mcp --api-key YOUR_API_KEY --model google/gemini-2.5-flash
```

**Cursor configuration with custom model:**

```json
{
  "mcpServers": {
    "context7-chat": {
      "command": "npx",
      "args": [
        "-y",
        "@upstash/context7-chat-mcp",
        "--api-key",
        "YOUR_API_KEY",
        "--model",
        "google/gemini-2.5-flash"
      ]
    }
  }
}
```

## Local Development

Clone the repository and navigate to the package:

```bash
git clone https://github.com/upstash/context7.git
cd context7/packages/mcp-chat
```

Install dependencies and build:

```bash
pnpm install
pnpm run build
```

Run the server:

```bash
# Using built version
node dist/index.js --api-key YOUR_API_KEY

# Using TypeScript source directly
npx tsx src/index.ts --api-key YOUR_API_KEY
```

### Local MCP Configuration

For local development, you can configure your MCP client to use the TypeScript source directly:

**Cursor (`~/.cursor/mcp.json`):**

```json
{
  "mcpServers": {
    "context7-chat": {
      "command": "npx",
      "args": [
        "tsx",
        "/path/to/context7/packages/mcp-chat/src/index.ts",
        "--api-key",
        "YOUR_API_KEY"
      ]
    }
  }
}
```

**VS Code:**

```json
{
  "mcp": {
    "servers": {
      "context7-chat": {
        "type": "stdio",
        "command": "npx",
        "args": [
          "tsx",
          "/path/to/context7/packages/mcp-chat/src/index.ts",
          "--api-key",
          "YOUR_API_KEY"
        ]
      }
    }
  }
}
```

### Development Commands

```bash
# Install dependencies
pnpm install

# Build
pnpm run build

# Watch mode (auto-rebuild on changes)
pnpm run dev

# Run built version
pnpm run start

# Lint
pnpm run lint

# Format
pnpm run format
```

## License

MIT
