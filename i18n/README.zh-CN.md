![Cover](https://github.com/upstash/context7/blob/master/public/cover.png?raw=true)

[![安装 MCP 服务器](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/en/install-mcp?name=context7&config=eyJ1cmwiOiJodHRwczovL21jcC5jb250ZXh0Ny5jb20vbWNwIn0%3D)

# Context7 MCP - 为所有 Prompt 获取最新文档

[![Website](https://img.shields.io/badge/Website-context7.com-blue)](https://context7.com) [![smithery badge](https://smithery.ai/badge/@upstash/context7-mcp)](https://smithery.ai/server/@upstash/context7-mcp) [![NPM Version](https://img.shields.io/npm/v/%40upstash%2Fcontext7-mcp?color=red)](https://www.npmjs.com/package/@upstash/context7-mcp) [![MIT licensed](https://img.shields.io/npm/l/%40upstash%2Fcontext7-mcp)](./LICENSE)

[![English](https://img.shields.io/badge/docs-English-purple)](../README.md) [![繁體中文](https://img.shields.io/badge/docs-繁體中文-yellow)](./README.zh-TW.md) [![日本語](https://img.shields.io/badge/docs-日本語-b7003a)](./README.ja.md) [![한국어 문서](https://img.shields.io/badge/docs-한국어-green)](./README.ko.md) [![Documentación en Español](https://img.shields.io/badge/docs-Español-orange)](./README.es.md) [![Documentation en Français](https://img.shields.io/badge/docs-Français-blue)](./README.fr.md) [![Documentação em Português (Brasil)](<https://img.shields.io/badge/docs-Português%20(Brasil)-purple>)](./README.pt-BR.md) [![Documentazione in italiano](https://img.shields.io/badge/docs-Italian-red)](./README.it.md) [![Dokumentasi Bahasa Indonesia](https://img.shields.io/badge/docs-Bahasa%20Indonesia-pink)](./README.id-ID.md) [![Dokumentation auf Deutsch](https://img.shields.io/badge/docs-Deutsch-darkgreen)](./README.de.md) [![Документация на русском языке](https://img.shields.io/badge/docs-Русский-darkblue)](./README.ru.md) [![Українська документація](https://img.shields.io/badge/docs-Українська-lightblue)](./README.uk.md) [![Türkçe Doküman](https://img.shields.io/badge/docs-Türkçe-blue)](./README.tr.md) [![Arabic Documentation](https://img.shields.io/badge/docs-Arabic-white)](./README.ar.md) [![Tiếng Việt](https://img.shields.io/badge/docs-Tiếng%20Việt-red)](./README.vi.md)

## ❌ 不使用 Context7

大语言模型（LLM）依赖过时或通用的库信息。你会遇到：

- ❌ 代码示例已过时，基于一年前的训练数据
- ❌ 产生根本不存在的幻觉 API
- ❌ 针对旧版本包的通用回答

## ✅ 使用 Context7

Context7 MCP 直接从源头获取最新的、特定版本的文档和代码示例——并将它们直接放入你的提示中。

在你的提示中添加 `use context7`（或[设置规则](#添加规则)自动调用）：

```txt
创建一个 Next.js 中间件，检查 cookies 中的有效 JWT，
并将未认证用户重定向到 `/login`。use context7
```

```txt
配置 Cloudflare Worker 脚本，将 JSON API 响应
缓存五分钟。use context7
```

Context7 将最新的代码示例和文档直接获取到你的 LLM 上下文中。无需切换标签页，不会产生不存在的幻觉 API，不会生成过时的代码。

## 安装

> [!NOTE]
> **推荐使用 API 密钥**：在 [context7.com/dashboard](https://context7.com/dashboard) 获取免费 API 密钥，可获得更高的请求速率限制。

<details>
<summary><b>在 Cursor 中安装</b></summary>

前往：`Settings` -> `Cursor Settings` -> `MCP` -> `Add new global MCP server`

推荐将以下配置粘贴到你的 Cursor `~/.cursor/mcp.json` 文件中。你也可以通过在项目文件夹中创建 `.cursor/mcp.json` 在特定项目中安装。更多信息请参阅 [Cursor MCP 文档](https://docs.cursor.com/context/model-context-protocol)。

> 自 Cursor 1.0 起，你可以点击下面的安装按钮进行即时一键安装。

#### Cursor 远程服务器连接

[![安装 MCP 服务器](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/en/install-mcp?name=context7&config=eyJ1cmwiOiJodHRwczovL21jcC5jb250ZXh0Ny5jb20vbWNwIn0%3D)

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

#### Cursor 本地服务器连接

[![安装 MCP 服务器](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/en/install-mcp?name=context7&config=eyJjb21tYW5kIjoibnB4IC15IEB1cHN0YXNoL2NvbnRleHQ3LW1jcCJ9)

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
<summary><b>在 Claude Code 中安装</b></summary>

运行以下命令。更多信息请参见 [Claude Code MCP 文档](https://code.claude.com/docs/en/mcp)。

#### Claude Code 本地服务器连接

```sh
claude mcp add context7 -- npx -y @upstash/context7-mcp --api-key YOUR_API_KEY
```

#### Claude Code 远程服务器连接

```sh
claude mcp add --header "CONTEXT7_API_KEY: YOUR_API_KEY" --transport http context7 https://mcp.context7.com/mcp
```

</details>

<details>
<summary><b>在 Opencode 中安装</b></summary>

将此内容添加到你的 Opencode 配置文件中。更多信息请参见 [Opencode MCP 文档](https://opencode.ai/docs/mcp-servers)。

#### Opencode 远程服务器连接

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

#### Opencode 本地服务器连接

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

**[其他 IDE 和客户端 →](https://context7.com/docs/resources/all-clients)**

<details>
<summary><b>OAuth 认证</b></summary>

Context7 MCP 服务器支持 OAuth 2.0 认证，适用于实现了 [MCP OAuth 规范](https://modelcontextprotocol.io/specification/2025-03-26/basic/authorization)的 MCP 客户端。

要使用 OAuth，请在客户端配置中将端点从 `/mcp` 更改为 `/mcp/oauth`：

```diff
- "url": "https://mcp.context7.com/mcp"
+ "url": "https://mcp.context7.com/mcp/oauth"
```

OAuth 仅适用于远程 HTTP 连接。对于使用 stdio 传输的本地 MCP 连接，请改用 API 密钥认证。

</details>

## 重要提示

### 添加规则

为避免每次都在提示中输入 `use context7`，你可以在 MCP 客户端中添加规则，自动为代码相关问题调用 Context7：

- **Cursor**：`Cursor Settings > Rules`
- **Claude Code**：`CLAUDE.md`
- 或你的 MCP 客户端中的等效设置

**规则示例：**

```txt
当我需要库/API 文档、代码生成、设置或配置步骤时，始终使用 Context7 MCP，无需我明确要求。
```

### 使用库 ID

如果你已经确切知道要使用哪个库，请将其 Context7 ID 添加到你的提示中。这样，Context7 MCP 服务器可以跳过库匹配步骤，直接获取文档。

```txt
使用 Supabase 实现基本身份验证。use library /supabase/supabase 获取 API 和文档。
```

斜杠语法告诉 MCP 工具确切要为哪个库加载文档。

### 指定版本

要获取特定库版本的文档，只需在提示中提及版本：

```txt
如何设置 Next.js 14 中间件？use context7
```

Context7 将自动匹配适当的版本。

## 可用工具

Context7 MCP 提供以下 LLM 可使用的工具：

- `resolve-library-id`：将通用库名称解析为 Context7 兼容的库 ID。
  - `query`（必需）：用户的问题或任务（用于按相关性排名结果）
  - `libraryName`（必需）：要搜索的库名称

- `query-docs`：使用 Context7 兼容的库 ID 获取库的文档。
  - `libraryId`（必需）：精确的 Context7 兼容库 ID（例如 `/mongodb/docs`、`/vercel/next.js`）
  - `query`（必需）：用于获取相关文档的问题或任务

## 更多文档

- [更多 MCP 客户端](https://context7.com/docs/resources/all-clients) - 30+ 客户端的安装说明
- [添加库](https://context7.com/docs/adding-libraries) - 将你的库提交到 Context7
- [故障排除](https://context7.com/docs/resources/troubleshooting) - 常见问题和解决方案
- [API 参考](https://context7.com/docs/api-guide) - REST API 文档
- [开发者指南](https://context7.com/docs/resources/developer) - 本地运行 Context7 MCP

## 免责声明

1- Context7 项目由社区贡献，虽然我们努力保持高质量，但我们不能保证所有库文档的准确性、完整性或安全性。Context7 中列出的项目由其各自所有者开发和维护，而非由 Context7 开发和维护。如果你遇到任何可疑、不当或潜在有害的内容，请使用项目页面上的"举报"按钮立即通知我们。我们认真对待所有举报，并将及时审查标记的内容，以维护我们平台的完整性和安全性。使用 Context7 即表示你承认自行承担风险。

2- 本仓库托管 MCP 服务器的源代码。支持组件——API 后端、解析引擎和爬取引擎——是私有的，不包含在本仓库中。

## 🤝 与我们联系

保持更新并加入我们的社区：

- 📢 在 [X](https://x.com/context7ai) 上关注我们获取最新新闻和更新
- 🌐 访问我们的[网站](https://context7.com)
- 💬 加入我们的 [Discord 社区](https://upstash.com/discord)

## 📺 Context7 媒体报道

- [Better Stack："免费工具让 Cursor 智能 10 倍"](https://youtu.be/52FC3qObp9E)
- [Cole Medin："这绝对是 AI 编码助手的最佳 MCP 服务器"](https://www.youtube.com/watch?v=G7gK8H6u7Rs)
- [Income Stream Surfers："Context7 + SequentialThinking MCPs：这是 AGI 吗？"](https://www.youtube.com/watch?v=-ggvzyLpK6o)
- [Julian Goldie SEO："Context7：新的 MCP AI 代理更新"](https://www.youtube.com/watch?v=CTZm6fBYisc)
- [JeredBlu："Context 7 MCP：即时获取文档 + VS Code 设置"](https://www.youtube.com/watch?v=-ls0D-rtET4)
- [Income Stream Surfers："Context7：将改变 AI 编码的新 MCP 服务器"](https://www.youtube.com/watch?v=PS-2Azb-C3M)
- [AICodeKing："Context7 + Cline & RooCode：这个 MCP 服务器让 CLINE 效果提升 100 倍！"](https://www.youtube.com/watch?v=qZfENAPMnyo)
- [Sean Kochel："5 个让编码更爽的 MCP 服务器（即插即用）"](https://www.youtube.com/watch?v=LqTQi8qexJM)

## ⭐ Star 历史

[![Star 历史图表](https://api.star-history.com/svg?repos=upstash/context7&type=Date)](https://www.star-history.com/#upstash/context7&Date)

## 📄 许可证

MIT
