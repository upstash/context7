![Cover](https://github.com/upstash/context7/blob/master/public/cover.png?raw=true)

[![安裝 MCP 伺服器](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/en/install-mcp?name=context7&config=eyJ1cmwiOiJodHRwczovL21jcC5jb250ZXh0Ny5jb20vbWNwIn0%3D)

# Context7 MCP - 即時更新的程式碼文件，適用於任何提示

[![Website](https://img.shields.io/badge/Website-context7.com-blue)](https://context7.com) [![smithery badge](https://smithery.ai/badge/@upstash/context7-mcp)](https://smithery.ai/server/@upstash/context7-mcp) [![NPM Version](https://img.shields.io/npm/v/%40upstash%2Fcontext7-mcp?color=red)](https://www.npmjs.com/package/@upstash/context7-mcp) [![MIT licensed](https://img.shields.io/npm/l/%40upstash%2Fcontext7-mcp)](./LICENSE)

[![English](https://img.shields.io/badge/docs-English-purple)](../README.md) [![简体中文](https://img.shields.io/badge/docs-简体中文-yellow)](./README.zh-CN.md) [![日本語](https://img.shields.io/badge/docs-日本語-b7003a)](./README.ja.md) [![한국어 문서](https://img.shields.io/badge/docs-한국어-green)](./README.ko.md) [![Documentación en Español](https://img.shields.io/badge/docs-Español-orange)](./README.es.md) [![Documentation en Français](https://img.shields.io/badge/docs-Français-blue)](./README.fr.md) [![Documentação em Português (Brasil)](<https://img.shields.io/badge/docs-Português%20(Brasil)-purple>)](./README.pt-BR.md) [![Documentazione in italiano](https://img.shields.io/badge/docs-Italian-red)](./README.it.md) [![Dokumentasi Bahasa Indonesia](https://img.shields.io/badge/docs-Bahasa%20Indonesia-pink)](./README.id-ID.md) [![Dokumentation auf Deutsch](https://img.shields.io/badge/docs-Deutsch-darkgreen)](./README.de.md) [![Документация на русском языке](https://img.shields.io/badge/docs-Русский-darkblue)](./README.ru.md) [![Українська документація](https://img.shields.io/badge/docs-Українська-lightblue)](./README.uk.md) [![Türkçe Doküman](https://img.shields.io/badge/docs-Türkçe-blue)](./README.tr.md) [![Arabic Documentation](https://img.shields.io/badge/docs-Arabic-white)](./README.ar.md) [![Tiếng Việt](https://img.shields.io/badge/docs-Tiếng%20Việt-red)](./README.vi.md)

## ❌ 沒有 Context7

大型語言模型（LLM）依賴過時或通用的函式庫資訊。你會遇到：

- ❌ 程式碼範例已過時，基於一年前的訓練資料
- ❌ 產生根本不存在的幻覺 API
- ❌ 針對舊版本套件的通用回答

## ✅ 有了 Context7

Context7 MCP 直接從來源取得最新的、特定版本的文件與程式碼範例——並直接放入你的提示中。

在你的提示中加入 `use context7`（或[設定規則](#新增規則)自動調用）：

```txt
建立一個 Next.js 中介軟體，檢查 cookies 中的有效 JWT，
並將未認證使用者重新導向至 `/login`。use context7
```

```txt
設定 Cloudflare Worker 腳本，將 JSON API 回應
快取五分鐘。use context7
```

Context7 將最新的程式碼範例與文件直接取得到你的 LLM 上下文中。不需切換分頁、不會產生不存在的幻覺 API、不會產生過時的程式碼。

## 安裝

> [!NOTE]
> **建議使用 API 金鑰**：在 [context7.com/dashboard](https://context7.com/dashboard) 取得免費 API 金鑰，可獲得更高的請求速率限制。

<details>
<summary><b>在 Cursor 中安裝</b></summary>

前往：`Settings` -> `Cursor Settings` -> `MCP` -> `Add new global MCP server`

建議將下列設定貼到你的 Cursor `~/.cursor/mcp.json` 檔案中。你也可以透過在專案資料夾中建立 `.cursor/mcp.json` 在特定專案中安裝。更多資訊請參閱 [Cursor MCP 文件](https://docs.cursor.com/context/model-context-protocol)。

> 自 Cursor 1.0 起，你可以點擊下方的安裝按鈕進行即時一鍵安裝。

#### Cursor 遠端伺服器連線

[![安裝 MCP 伺服器](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/en/install-mcp?name=context7&config=eyJ1cmwiOiJodHRwczovL21jcC5jb250ZXh0Ny5jb20vbWNwIn0%3D)

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

#### Cursor 本地伺服器連線

[![安裝 MCP 伺服器](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/en/install-mcp?name=context7&config=eyJjb21tYW5kIjoibnB4IC15IEB1cHN0YXNoL2NvbnRleHQ3LW1jcCJ9)

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
<summary><b>在 Claude Code 中安裝</b></summary>

執行下列指令。更多資訊請參見 [Claude Code MCP 文件](https://code.claude.com/docs/en/mcp)。

#### Claude Code 本地伺服器連線

```sh
claude mcp add context7 -- npx -y @upstash/context7-mcp --api-key YOUR_API_KEY
```

#### Claude Code 遠端伺服器連線

```sh
claude mcp add --header "CONTEXT7_API_KEY: YOUR_API_KEY" --transport http context7 https://mcp.context7.com/mcp
```

</details>

<details>
<summary><b>在 Opencode 中安裝</b></summary>

將此內容加入你的 Opencode 設定檔。更多資訊請參見 [Opencode MCP 文件](https://opencode.ai/docs/mcp-servers)。

#### Opencode 遠端伺服器連線

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

#### Opencode 本地伺服器連線

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

**[其他 IDE 和客戶端 →](https://context7.com/docs/resources/all-clients)**

<details>
<summary><b>OAuth 認證</b></summary>

Context7 MCP 伺服器支援 OAuth 2.0 認證，適用於實作了 [MCP OAuth 規範](https://modelcontextprotocol.io/specification/2025-03-26/basic/authorization)的 MCP 客戶端。

要使用 OAuth，請在客戶端設定中將端點從 `/mcp` 更改為 `/mcp/oauth`：

```diff
- "url": "https://mcp.context7.com/mcp"
+ "url": "https://mcp.context7.com/mcp/oauth"
```

OAuth 僅適用於遠端 HTTP 連線。對於使用 stdio 傳輸的本地 MCP 連線，請改用 API 金鑰認證。

</details>

## 重要提示

### 新增規則

為避免每次都在提示中輸入 `use context7`，你可以在 MCP 客戶端中新增規則，自動為程式碼相關問題調用 Context7：

- **Cursor**：`Cursor Settings > Rules`
- **Claude Code**：`CLAUDE.md`
- 或你的 MCP 客戶端中的等效設定

**規則範例：**

```txt
當我需要函式庫/API 文件、程式碼產生、設定或設定步驟時，始終使用 Context7 MCP，無需我明確要求。
```

### 使用函式庫 ID

如果你已經確切知道要使用哪個函式庫，請將其 Context7 ID 加入你的提示中。這樣，Context7 MCP 伺服器可以跳過函式庫匹配步驟，直接取得文件。

```txt
使用 Supabase 實作基本身分驗證。use library /supabase/supabase 取得 API 和文件。
```

斜線語法告訴 MCP 工具確切要為哪個函式庫載入文件。

### 指定版本

要取得特定函式庫版本的文件，只需在提示中提及版本：

```txt
如何設定 Next.js 14 中介軟體？use context7
```

Context7 將自動匹配適當的版本。

## 可用工具

Context7 MCP 提供下列 LLM 可使用的工具：

- `resolve-library-id`：將通用函式庫名稱解析為 Context7 相容的函式庫 ID。
  - `query`（必填）：使用者的問題或任務（用於按相關性排名結果）
  - `libraryName`（必填）：要搜尋的函式庫名稱

- `query-docs`：使用 Context7 相容的函式庫 ID 取得函式庫的文件。
  - `libraryId`（必填）：精確的 Context7 相容函式庫 ID（例如 `/mongodb/docs`、`/vercel/next.js`）
  - `query`（必填）：用於取得相關文件的問題或任務

## 更多文件

- [更多 MCP 客戶端](https://context7.com/docs/resources/all-clients) - 30+ 客戶端的安裝說明
- [新增函式庫](https://context7.com/docs/adding-libraries) - 將你的函式庫提交到 Context7
- [疑難排解](https://context7.com/docs/resources/troubleshooting) - 常見問題與解決方案
- [API 參考](https://context7.com/docs/api-guide) - REST API 文件
- [開發者指南](https://context7.com/docs/resources/developer) - 本地執行 Context7 MCP

## 免責聲明

1- Context7 專案由社群貢獻，雖然我們致力於維持高品質，但我們無法保證所有函式庫文件的準確性、完整性或安全性。Context7 中列出的專案由其各自擁有者開發和維護，而非由 Context7 開發和維護。如果你遇到任何可疑、不當或潛在有害的內容，請使用專案頁面上的「檢舉」按鈕立即通知我們。我們認真對待所有檢舉，並將及時審查標記的內容，以維護我們平台的完整性和安全性。使用 Context7 即表示你承認自行承擔風險。

2- 本儲存庫託管 MCP 伺服器的原始碼。支援元件——API 後端、解析引擎和爬取引擎——是私有的，不包含在本儲存庫中。

## 🤝 與我們聯繫

保持更新並加入我們的社群：

- 📢 在 [X](https://x.com/context7ai) 上追蹤我們取得最新消息和更新
- 🌐 造訪我們的[網站](https://context7.com)
- 💬 加入我們的 [Discord 社群](https://upstash.com/discord)

## 📺 Context7 媒體報導

- [Better Stack：「免費工具讓 Cursor 智慧 10 倍」](https://youtu.be/52FC3qObp9E)
- [Cole Medin：「這絕對是 AI 程式助理最強 MCP 伺服器」](https://www.youtube.com/watch?v=G7gK8H6u7Rs)
- [Income Stream Surfers：「Context7 + SequentialThinking MCPs：這是 AGI 嗎？」](https://www.youtube.com/watch?v=-ggvzyLpK6o)
- [Julian Goldie SEO：「Context7：全新 MCP AI 代理更新」](https://www.youtube.com/watch?v=CTZm6fBYisc)
- [JeredBlu：「Context 7 MCP：即時取得文件 + VS Code 設定」](https://www.youtube.com/watch?v=-ls0D-rtET4)
- [Income Stream Surfers：「Context7：將改變 AI 程式開發的新 MCP 伺服器」](https://www.youtube.com/watch?v=PS-2Azb-C3M)
- [AICodeKing：「Context7 + Cline & RooCode：這個 MCP 伺服器讓 CLINE 效率提升 100 倍！」](https://www.youtube.com/watch?v=qZfENAPMnyo)
- [Sean Kochel：「5 個讓程式開發如虎添翼的 MCP 伺服器（即插即用）」](https://www.youtube.com/watch?v=LqTQi8qexJM)

## ⭐ Star 歷史

[![Star 歷史圖表](https://api.star-history.com/svg?repos=upstash/context7&type=Date)](https://www.star-history.com/#upstash/context7&Date)

## 📄 授權

MIT
