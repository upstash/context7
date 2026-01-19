![Cover](https://github.com/upstash/context7/blob/master/public/cover.png?raw=true)

[![Install MCP Server](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/en/install-mcp?name=context7&config=eyJ1cmwiOiJodHRwczovL21jcC5jb250ZXh0Ny5jb20vbWNwIn0%3D)

# Context7 MCP - Up-to-date Code Docs For Any Prompt

[![Website](https://img.shields.io/badge/Website-context7.com-blue)](https://context7.com) [![smithery badge](https://smithery.ai/badge/@upstash/context7-mcp)](https://smithery.ai/server/@upstash/context7-mcp) [![NPM Version](https://img.shields.io/npm/v/%40upstash%2Fcontext7-mcp?color=red)](https://www.npmjs.com/package/@upstash/context7-mcp) [![MIT licensed](https://img.shields.io/npm/l/%40upstash%2Fcontext7-mcp)](./LICENSE)

[![繁體中文](https://img.shields.io/badge/docs-繁體中文-yellow)](./i18n/README.zh-TW.md) [![简体中文](https://img.shields.io/badge/docs-简体中文-yellow)](./i18n/README.zh-CN.md) [![日本語](https://img.shields.io/badge/docs-日本語-b7003a)](./i18n/README.ja.md) [![한국어 문서](https://img.shields.io/badge/docs-한국어-green)](./i18n/README.ko.md) [![Documentación en Español](https://img.shields.io/badge/docs-Español-orange)](./i18n/README.es.md) [![Documentation en Français](https://img.shields.io/badge/docs-Français-blue)](./i18n/README.fr.md) [![Documentação em Português (Brasil)](<https://img.shields.io/badge/docs-Português%20(Brasil)-purple>)](./i18n/README.pt-BR.md) [![Documentazione in italiano](https://img.shields.io/badge/docs-Italian-red)](./i18n/README.it.md) [![Dokumentasi Bahasa Indonesia](https://img.shields.io/badge/docs-Bahasa%20Indonesia-pink)](./i18n/README.id-ID.md) [![Dokumentation auf Deutsch](https://img.shields.io/badge/docs-Deutsch-darkgreen)](./i18n/README.de.md) [![Документация на русском языке](https://img.shields.io/badge/docs-Русский-darkblue)](./i18n/README.ru.md) [![Українська документація](https://img.shields.io/badge/docs-Українська-lightblue)](./i18n/README.uk.md) [![Türkçe Doküman](https://img.shields.io/badge/docs-Türkçe-blue)](./i18n/README.tr.md) [![Arabic Documentation](https://img.shields.io/badge/docs-Arabic-white)](./i18n/README.ar.md) [![Tiếng Việt](https://img.shields.io/badge/docs-Tiếng%20Việt-red)](./i18n/README.vi.md)

## ❌ Without Context7

LLMs rely on outdated or generic information about the libraries you use. You get:

- ❌ Code examples are outdated and based on year-old training data
- ❌ Hallucinated APIs that don't even exist
- ❌ Generic answers for old package versions

## ✅ With Context7

Context7 MCP pulls up-to-date, version-specific documentation and code examples straight from the source — and places them directly into your prompt.

Add `use context7` to your prompt (or [set up a rule](#add-a-rule) to auto-invoke):

```txt
Create a Next.js middleware that checks for a valid JWT in cookies
and redirects unauthenticated users to `/login`. use context7
```

```txt
Configure a Cloudflare Worker script to cache
JSON API responses for five minutes. use context7
```

Context7 fetches up-to-date code examples and documentation right into your LLM's context. No tab-switching, no hallucinated APIs that don't exist, no outdated code generation.
This is a great observation. For most users, "Local Server" sounds like something they need to set up themselves, while "Remote" sounds like the standard way to use a cloud service.

To make this more intuitive, I've renamed **Remote Server** to **Cloud (Recommended)** and **Local Server** to **Self-Hosted (Advanced)**. I also reordered the sections so the easiest, most common method (Cloud) always comes first.

---

## Installation

> [!TIP]
> **API Key Recommended**: Get a free API key at [context7.com/dashboard](https://context7.com/dashboard) for higher rate limits and persistent context.

<details open>
<summary><b>Install in Cursor</b></summary>

The fastest way to use Context7 in Cursor is via our Cloud endpoint.

#### 1. Cloud (Recommended)

Click the button below for instant one-click installation, or manually add the JSON config to your `~/.cursor/mcp.json`.

```json
{
  "mcpServers": {
    "context7": {
      "url": "https://mcp.context7.com/mcp",
      "headers": {
        "CONTEXT7_API_KEY": "YOUR_API_KEY"
      }
    }
  }
}

```

#### 2. Self-Hosted (Advanced)

Use this if you prefer to run the MCP server binary locally on your machine via Node.js.

```json
{
  "mcpServers": {
    "context7": {
      "command": "npx",
      "args": ["-y", "@upstash/context7-mcp", "--api-key", "YOUR_API_KEY"]
    }
  }
}

```

</details>

<details>
<summary><b>Install in Claude Code</b></summary>

Run the following commands in your terminal. See [Claude Code MCP docs](https://code.claude.com/docs/en/mcp) for more info.

#### Cloud (Recommended)

```sh
claude mcp add --header "CONTEXT7_API_KEY: YOUR_API_KEY" --transport http context7 https://mcp.context7.com/mcp

```

#### Self-Hosted (Advanced)

```sh
claude mcp add context7 -- npx -y @upstash/context7-mcp --api-key YOUR_API_KEY

```

</details>

<details>
<summary><b>Install in Opencode</b></summary>

Add this to your Opencode configuration file.

#### Cloud (Recommended)

```json
"mcp": {
  "context7": {
    "type": "remote",
    "url": "https://mcp.context7.com/mcp",
    "headers": {
      "CONTEXT7_API_KEY": "YOUR_API_KEY"
    },
    "enabled": true
  }
}

```

#### Self-Hosted (Advanced)

```json
{
  "mcp": {
    "context7": {
      "type": "local",
      "command": ["npx", "-y", "@upstash/context7-mcp", "--api-key", "YOUR_API_KEY"],
      "enabled": true
    }
  }
}

```

</details>

**[Other IDEs and Clients →](https://context7.com/docs/resources/all-clients)**

---

### Authentication Options

| Method | Description | Best For |
| --- | --- | --- |
| **API Key** | Default method. Pass via headers or CLI flags. | All users / Quick start |
| **OAuth** | Connect via the [MCP OAuth spec](https://modelcontextprotocol.io/specification/2025-03-26/basic/authorization). | Enterprise / Teams |

To use **OAuth**, change your Cloud endpoint URL:

```diff
- "url": "https://mcp.context7.com/mcp"
+ "url": "https://mcp.context7.com/mcp/oauth"

```

*Note: OAuth is only available for Cloud (HTTP) connections.*

## Important Tips

### Add a Rule

To avoid typing `use context7` in every prompt, add a rule to your MCP client to automatically invoke Context7 for code-related questions:

- **Cursor**: `Cursor Settings > Rules`
- **Claude Code**: `CLAUDE.md`
- Or the equivalent in your MCP client

**Example rule:**

```txt
Always use Context7 MCP when I need library/API documentation, code generation, setup or configuration steps without me having to explicitly ask.
```

### Use Library Id

If you already know exactly which library you want to use, add its Context7 ID to your prompt. That way, Context7 MCP server can skip the library-matching step and directly continue with retrieving docs.

```txt
Implement basic authentication with Supabase. use library /supabase/supabase for API and docs.
```

The slash syntax tells the MCP tool exactly which library to load docs for.

### Specify a Version

To get documentation for a specific library version, just mention the version in your prompt:

```txt
How do I set up Next.js 14 middleware? use context7
```

Context7 will automatically match the appropriate version.

## Available Tools

Context7 MCP provides the following tools that LLMs can use:

- `resolve-library-id`: Resolves a general library name into a Context7-compatible library ID.
  - `query` (required): The user's question or task (used to rank results by relevance)
  - `libraryName` (required): The name of the library to search for

- `query-docs`: Retrieves documentation for a library using a Context7-compatible library ID.
  - `libraryId` (required): Exact Context7-compatible library ID (e.g., `/mongodb/docs`, `/vercel/next.js`)
  - `query` (required): The question or task to get relevant documentation for

## More Documentation

- [More MCP Clients](https://context7.com/docs/resources/all-clients) - Installation for 30+ clients
- [Adding Libraries](https://context7.com/docs/adding-libraries) - Submit your library to Context7
- [Troubleshooting](https://context7.com/docs/resources/troubleshooting) - Common issues and solutions
- [API Reference](https://context7.com/docs/api-guide) - REST API documentation
- [Developer Guide](https://context7.com/docs/resources/developer) - Run Context7 MCP locally

## Disclaimer

1- Context7 projects are community-contributed and while we strive to maintain high quality, we cannot guarantee the accuracy, completeness, or security of all library documentation. Projects listed in Context7 are developed and maintained by their respective owners, not by Context7. If you encounter any suspicious, inappropriate, or potentially harmful content, please use the "Report" button on the project page to notify us immediately. We take all reports seriously and will review flagged content promptly to maintain the integrity and safety of our platform. By using Context7, you acknowledge that you do so at your own discretion and risk.

2- This repository hosts the MCP server’s source code. The supporting components — API backend, parsing engine, and crawling engine — are private and not part of this repository.

## 🤝 Connect with Us

Stay updated and join our community:

- 📢 Follow us on [X](https://x.com/context7ai) for the latest news and updates
- 🌐 Visit our [Website](https://context7.com)
- 💬 Join our [Discord Community](https://upstash.com/discord)

## 📺 Context7 In Media

- [Better Stack: "Free Tool Makes Cursor 10x Smarter"](https://youtu.be/52FC3qObp9E)
- [Cole Medin: "This is Hands Down the BEST MCP Server for AI Coding Assistants"](https://www.youtube.com/watch?v=G7gK8H6u7Rs)
- [Income Stream Surfers: "Context7 + SequentialThinking MCPs: Is This AGI?"](https://www.youtube.com/watch?v=-ggvzyLpK6o)
- [Julian Goldie SEO: "Context7: New MCP AI Agent Update"](https://www.youtube.com/watch?v=CTZm6fBYisc)
- [JeredBlu: "Context 7 MCP: Get Documentation Instantly + VS Code Setup"](https://www.youtube.com/watch?v=-ls0D-rtET4)
- [Income Stream Surfers: "Context7: The New MCP Server That Will CHANGE AI Coding"](https://www.youtube.com/watch?v=PS-2Azb-C3M)
- [AICodeKing: "Context7 + Cline & RooCode: This MCP Server Makes CLINE 100X MORE EFFECTIVE!"](https://www.youtube.com/watch?v=qZfENAPMnyo)
- [Sean Kochel: "5 MCP Servers For Vibe Coding Glory (Just Plug-In & Go)"](https://www.youtube.com/watch?v=LqTQi8qexJM)

## ⭐ Star History

[![Star History Chart](https://api.star-history.com/svg?repos=upstash/context7&type=Date)](https://www.star-history.com/#upstash/context7&Date)

## 📄 License

MIT
