# Context7 MCP - Tài Liệu Code Cập Nhật Cho Mọi Prompt

[![Website](https://img.shields.io/badge/Website-context7.com-blue)](https://context7.com) [![smithery badge](https://smithery.ai/badge/@upstash/context7-mcp)](https://smithery.ai/server/@upstash/context7-mcp) [<img alt="Install in VS Code (npx)" src="https://img.shields.io/badge/VS_Code-VS_Code?style=flat-square&label=Install%20Context7%20MCP&color=0098FF">](https://insiders.vscode.dev/redirect?url=vscode%3Amcp%2Finstall%3F%7B%22name%22%3A%22context7%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40upstash%2Fcontext7-mcp%40latest%22%5D%7D)
[![繁體中文](https://img.shields.io/badge/docs-繁體中文-yellow)](./README.zh-TW.md) [![简体中文](https://img.shields.io/badge/docs-简体中文-yellow)](./README.zh-CN.md) [![日本語](https://img.shields.io/badge/docs-日本語-b7003a)](./README.ja.md) [![한국어 문서](https://img.shields.io/badge/docs-한국어-green)](./README.ko.md) [![Documentación en Español](https://img.shields.io/badge/docs-Español-orange)](./README.es.md) [![Documentation en Français](https://img.shields.io/badge/docs-Français-blue)](./README.fr.md) [![Documentação em Português (Brasil)](<https://img.shields.io/badge/docs-Português%20(Brasil)-purple>)](./README.pt-BR.md) [![Documentazione in italiano](https://img.shields.io/badge/docs-Italian-red)](./README.it.md) [![Dokumentasi Bahasa Indonesia](https://img.shields.io/badge/docs-Bahasa%20Indonesia-pink)](./README.id-ID.md) [![Dokumentation auf Deutsch](https://img.shields.io/badge/docs-Deutsch-darkgreen)](./README.de.md) [![Документация на русском языке](https://img.shields.io/badge/docs-Русский-darkblue)](./README.ru.md) [![Українська документація](https://img.shields.io/badge/docs-Українська-lightblue)](./README.uk.md) [![Türkçe Doküman](https://img.shields.io/badge/docs-Türkçe-blue)](./README.tr.md) [![Arabic Documentation](https://img.shields.io/badge/docs-Arabic-white)](./README.ar.md) [![Tiếng Việt](https://img.shields.io/badge/docs-Tiếng%20Việt-red)](./README.vi.md)

## ❌ Không có Context7

Các LLM dựa vào thông tin lỗi thời hoặc chung chung về các thư viện bạn sử dụng. Bạn sẽ gặp phải:

- ❌ Các ví dụ code lỗi thời và dựa trên dữ liệu huấn luyện cũ
- ❌ API được tạo ra không tồn tại thực sự
- ❌ Câu trả lời chung chung cho các phiên bản package cũ

## ✅ Với Context7

Context7 MCP lấy tài liệu và ví dụ code cập nhật, dành cho phiên bản cụ thể trực tiếp từ nguồn gốc — và đặt chúng trực tiếp vào prompt của bạn.
Thêm `use context7` vào prompt của bạn trong Cursor:

```txt
Tạo một Next.js middleware kiểm tra JWT hợp lệ trong cookies và chuyển hướng người dùng chưa xác thực đến `/login`. use context7
```

```txt
Cấu hình script Cloudflare Worker để cache JSON API responses trong năm phút. use context7
```

Context7 lấy các ví dụ code và tài liệu cập nhật ngay vào context của LLM.

- 1️⃣ Viết prompt một cách tự nhiên
- 2️⃣ Nói với LLM để `use context7`
- 3️⃣ Nhận được câu trả lời code hoạt động
  Không cần chuyển tab, không có API tự tạo không tồn tại, không có code generation lỗi thời.

## 📚 Thêm Dự Án

Xem [hướng dẫn thêm dự án](https://context7.com/docs/adding-libraries) để học cách thêm (hoặc cập nhật) các thư viện yêu thích của bạn vào Context7.

## 🛠️ Cài Đặt

### Yêu Cầu

- Node.js >= v18.0.0
- Cursor, Windsurf, Claude Desktop hoặc MCP Client khác
<details>
<summary><b>Cài đặt qua Smithery</b></summary>

Để cài đặt Context7 MCP Server cho bất kỳ client nào tự động qua [Smithery](https://smithery.ai/server/@upstash/context7-mcp):

```bash
npx -y @smithery/cli@latest install @upstash/context7-mcp --client <CLIENT_NAME> --key <YOUR_SMITHERY_KEY>
```

Bạn có thể tìm Smithery key của mình tại [trang web Smithery.ai](https://smithery.ai/server/@upstash/context7-mcp).

</details>

<details>
<summary><b>Cài đặt trong Cursor</b></summary>

Đi đến: `Settings` -> `Cursor Settings` -> `MCP` -> `Add new global MCP server`
Paste cấu hình sau vào file Cursor `~/.cursor/mcp.json` là cách được khuyến nghị. Bạn cũng có thể cài đặt trong một dự án cụ thể bằng cách tạo `.cursor/mcp.json` trong thư mục dự án. Xem [tài liệu Cursor MCP](https://docs.cursor.com/context/model-context-protocol) để biết thêm thông tin.
> Từ Cursor 1.0, bạn có thể click nút cài đặt bên dưới để cài đặt một cú click ngay lập tức.

#### Kết nối Cursor Remote Server
[![Install MCP Server](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/install-mcp?name=context7&config=eyJ1cmwiOiJodHRwczovL21jcC5jb250ZXh0Ny5jb20vbWNwIn0%3D)
```json
{
  "mcpServers": {
    "context7": {
      "url": "https://mcp.context7.com/mcp"
    }
  }
}
```

#### Kết nối Cursor Local Server
[![Install MCP Server](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/install-mcp?name=context7&config=eyJjb21tYW5kIjoibnB4IC15IEB1cHN0YXNoL2NvbnRleHQ3LW1jcCJ9)
```json
{
  "mcpServers": {
    "context7": {
      "command": "npx",
      "args": ["-y", "@upstash/context7-mcp"]
    }
  }
}
```
<details>
<summary>Thay thế: Sử dụng Bun</summary>

[![Install MCP Server](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/install-mcp?name=context7&config=eyJjb21tYW5kIjoiYnVueCAteSBAdXBzdGFzaC9jb250ZXh0Ny1tY3AifQ%3D%3D)
```json
{
  "mcpServers": {
    "context7": {
      "command": "bunx",
      "args": ["-y", "@upstash/context7-mcp"]
    }
  }
}
```
</details>

<details>
<summary>Thay thế: Sử dụng Deno</summary>

[![Install MCP Server](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/install-mcp?name=context7&config=eyJjb21tYW5kIjoiZGVubyBydW4gLS1hbGxvdy1lbnYgLS1hbGxvdy1uZXQgbnBtOkB1cHN0YXNoL2NvbnRleHQ3LW1jcCJ9)
```json
{
  "mcpServers": {
    "context7": {
      "command": "deno",
      "args": [
        "run",
        "--allow-env=NO_DEPRECATION,TRACE_DEPRECATION",
        "--allow-net",
        "npm:@upstash/context7-mcp"
      ]
    }
  }
}
```
</details>

</details>

<details>
<summary><b>Cài đặt trong Windsurf</b></summary>

Thêm cấu hình này vào file cấu hình Windsurf MCP của bạn. Xem [tài liệu Windsurf MCP](https://docs.windsurf.com/windsurf/mcp) để biết thêm thông tin.

#### Kết nối Windsurf Remote Server

```json
{
  "mcpServers": {
    "context7": {
      "serverUrl": "https://mcp.context7.com/mcp"
    }
  }
}
```

#### Kết nối Windsurf Local Server

```json
{
  "mcpServers": {
    "context7": {
      "command": "npx",
      "args": ["-y", "@upstash/context7-mcp"]
    }
  }
}
```
</details>

<details>
<summary><b>Cài đặt trong Trae</b></summary>

Sử dụng tính năng Add manually và điền thông tin cấu hình JSON cho MCP server đó.
Để biết thêm chi tiết, truy cập [tài liệu Trae](https://docs.trae.ai/ide/model-context-protocol?_lang=en).

#### Kết nối Trae Remote Server

```json
{
  "mcpServers": {
    "context7": {
      "url": "https://mcp.context7.com/mcp"
    }
  }
}
```

#### Kết nối Trae Local Server

```json
{
  "mcpServers": {
    "context7": {
      "command": "npx",
      "args": ["-y", "@upstash/context7-mcp"]
    }
  }
}
```
</details>

<details>
<summary><b>Cài đặt trong VS Code</b></summary>

[<img alt="Install in VS Code (npx)" src="https://img.shields.io/badge/VS_Code-VS_Code?style=flat-square&label=Install%20Context7%20MCP&color=0098FF">](https://insiders.vscode.dev/redirect?url=vscode%3Amcp%2Finstall%3F%7B%22name%22%3A%22context7%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40upstash%2Fcontext7-mcp%40latest%22%5D%7D)
[<img alt="Install in VS Code Insiders (npx)" src="https://img.shields.io/badge/VS_Code_Insiders-VS_Code_Insiders?style=flat-square&label=Install%20Context7%20MCP&color=24bfa5">](https://insiders.vscode.dev/redirect?url=vscode-insiders%3Amcp%2Finstall%3F%7B%22name%22%3A%22context7%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40upstash%2Fcontext7-mcp%40latest%22%5D%7D)
Thêm cấu hình này vào file cấu hình VS Code MCP của bạn. Xem [tài liệu VS Code MCP](https://code.visualstudio.com/docs/copilot/chat/mcp-servers) để biết thêm thông tin.

#### Kết nối VS Code Remote Server

```json
"mcp": {
  "servers": {
    "context7": {
      "type": "http",
      "url": "https://mcp.context7.com/mcp"
    }
  }
}
```

#### Kết nối VS Code Local Server

```json
"mcp": {
  "servers": {
    "context7": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@upstash/context7-mcp"]
    }
  }
}
```
</details>

<details>
<summary><b>Cài đặt trong Visual Studio 2022</b></summary>

Bạn có thể cấu hình Context7 MCP trong Visual Studio 2022 bằng cách làm theo [tài liệu Visual Studio MCP Servers](https://learn.microsoft.com/visualstudio/ide/mcp-servers?view=vs-2022).
Thêm cấu hình này vào file cấu hình Visual Studio MCP của bạn (xem [tài liệu Visual Studio](https://learn.microsoft.com/visualstudio/ide/mcp-servers?view=vs-2022) để biết chi tiết):
```json
{
  "mcp": {
    "servers": {
      "context7": {
        "type": "http",
        "url": "https://mcp.context7.com/mcp"
      }
    }
  }
}
```
Hoặc, cho local server:
```json
{
  "mcp": {
    "servers": {
      "context7": {
        "type": "stdio",
        "command": "npx",
        "args": ["-y", "@upstash/context7-mcp"]
      }
    }
  }
}
```
Để biết thêm thông tin và khắc phục sự cố, tham khảo [tài liệu Visual Studio MCP Servers](https://learn.microsoft.com/visualstudio/ide/mcp-servers?view=vs-2022).
</details>

<details>
<summary><b>Cài đặt trong Zed</b></summary>

Có thể cài đặt thông qua [Zed Extensions](https://zed.dev/extensions?query=Context7) hoặc bạn có thể thêm cấu hình này vào `settings.json` của Zed. Xem [tài liệu Zed Context Server](https://zed.dev/docs/assistant/context-servers) để biết thêm thông tin.
```json
{
  "context_servers": {
    "Context7": {
      "source": "custom",
      "command": "npx",
      "args": ["-y", "@upstash/context7-mcp", "--api-key", "YOUR_API_KEY"]
    }
  }
}
```
</details>

<details>
<summary><b>Cài đặt trong Gemini CLI</b></summary>

Xem [Cấu hình Gemini CLI](https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/configuration.md) để biết chi tiết.
1. Mở file cài đặt Gemini CLI. Vị trí là `~/.gemini/settings.json` (trong đó `~` là thư mục home của bạn).
2. Thêm cấu hình sau vào object `mcpServers` trong file `settings.json` của bạn:
```json
{
  "mcpServers": {
    "context7": {
      "httpUrl": "https://mcp.context7.com/mcp"
    }
  }
}
```
Hoặc, cho local server:
```json
{
  "mcpServers": {
    "context7": {
      "command": "npx",
      "args": ["-y", "@upstash/context7-mcp"]
    }
  }
}
```
Nếu object `mcpServers` không tồn tại, hãy tạo nó.
</details>

<details>
<summary><b>Cài đặt trong Claude Code</b></summary>

Chạy lệnh này. Xem [tài liệu Claude Code MCP](https://docs.anthropic.com/en/docs/claude-code/mcp) để biết thêm thông tin.

#### Kết nối Claude Code Local Server

```sh
claude mcp add --scope user context7 -- npx -y @upstash/context7-mcp
```

#### Kết nối Claude Code Remote Server

```sh
claude mcp add --scope user --transport http context7 https://mcp.context7.com/mcp
```
</details>

<details>
<summary><b>Cài đặt trong Claude Desktop</b></summary>

Thêm cấu hình này vào file `claude_desktop_config.json` của Claude Desktop. Xem [tài liệu Claude Desktop MCP](https://modelcontextprotocol.io/quickstart/user) để biết thêm thông tin.
```json
{
  "mcpServers": {
    "Context7": {
      "command": "npx",
      "args": ["-y", "@upstash/context7-mcp"]
    }
  }
}
```
</details>

<details>
<summary>
<b>Cài đặt trong Cline</b>
</summary>

Bạn có thể dễ dàng cài đặt Context7 thông qua [Cline MCP Server Marketplace](https://cline.bot/mcp-marketplace) bằng cách làm theo các hướng dẫn này:
1. Mở **Cline**.
2. Click biểu tượng menu hamburger (☰) để vào phần **MCP Servers**.
3. Sử dụng thanh tìm kiếm trong tab **Marketplace** để tìm _Context7_.
4. Click nút **Install**.
</details>

<details>
<summary><b>Cài đặt trong BoltAI</b></summary>

Mở trang "Settings" của ứng dụng, điều hướng đến "Plugins," và nhập JSON sau:
```json
{
  "mcpServers": {
    "context7": {
      "command": "npx",
      "args": ["-y", "@upstash/context7-mcp"]
    }
  }
}
```
Sau khi lưu, nhập trong chat `query-docs` theo sau bởi Context7 documentation ID của bạn (ví dụ: `query-docs /nuxt/ui`). Thêm thông tin có sẵn tại [trang Tài liệu BoltAI](https://docs.boltai.com/docs/plugins/mcp-servers). Cho BoltAI trên iOS, [xem hướng dẫn này](https://docs.boltai.com/docs/boltai-mobile/mcp-servers).
</details>

<details>
<summary><b>Sử dụng Docker</b></summary>

Nếu bạn muốn chạy MCP server trong Docker container:
1. **Build Docker Image:**
   Đầu tiên, tạo `Dockerfile` trong thư mục gốc dự án (hoặc bất cứ đâu bạn thích):
   <details>
   <summary>Click để xem nội dung Dockerfile</summary>

   ```Dockerfile
   FROM node:18-alpine
   WORKDIR /app
   # Cài đặt phiên bản mới nhất globally
   RUN npm install -g @upstash/context7-mcp
   # Expose default port nếu cần (tùy chọn, phụ thuộc vào tương tác MCP client)
   # EXPOSE 3000
   # Lệnh mặc định để chạy server
   CMD ["context7-mcp"]
   ```
   </details>

   Sau đó, build image sử dụng tag (ví dụ: `context7-mcp`). **Đảm bảo Docker Desktop (hoặc Docker daemon) đang chạy.** Chạy lệnh sau trong cùng thư mục nơi bạn lưu `Dockerfile`:
   ```bash
   docker build -t context7-mcp .
   ```
2. **Cấu hình MCP Client của bạn:**
   Cập nhật cấu hình MCP client của bạn để sử dụng lệnh Docker.
   _Ví dụ cho cline_mcp_settings.json:_
   ```json
   {
     "mcpServers": {
       "Сontext7": {
         "autoApprove": [],
         "disabled": false,
         "timeout": 60,
         "command": "docker",
         "args": ["run", "-i", "--rm", "context7-mcp"],
         "transportType": "stdio"
       }
     }
   }
   ```
   _Lưu ý: Đây là một ví dụ cấu hình. Vui lòng tham khảo các ví dụ cụ thể cho MCP client của bạn (như Cursor, VS Code, v.v.) ở phần trước trong README này để điều chỉnh cấu trúc (ví dụ: `mcpServers` vs `servers`). Ngoài ra, đảm bảo tên image trong `args` khớp với tag được sử dụng trong lệnh `docker build`._
</details>

<details>
<summary><b>Cài đặt trong Windows</b></summary>

Cấu hình trên Windows hơi khác so với Linux hoặc macOS (_`Cline` được sử dụng trong ví dụ_). Nguyên tắc tương tự áp dụng cho các editor khác; tham khảo cấu hình của `command` và `args`.
```json
{
  "mcpServers": {
    "github.com/upstash/context7-mcp": {
      "command": "cmd",
      "args": ["/c", "npx", "-y", "@upstash/context7-mcp@latest"],
      "disabled": false,
      "autoApprove": []
    }
  }
}
```
</details>

<details>
<summary><b>Cài đặt trong Augment Code</b></summary>

Để cấu hình Context7 MCP trong Augment Code, bạn có thể sử dụng giao diện đồ họa hoặc cấu hình thủ công.

### **A. Sử dụng Augment Code UI**
1. Click menu hamburger.
2. Chọn **Settings**.
3. Điều hướng đến phần **Tools**.
4. Click nút **+ Add MCP**.
5. Nhập lệnh sau:
   ```
   npx -y @upstash/context7-mcp@latest
   ```
6. Đặt tên MCP: **Context7**.
7. Click nút **Add**.
Sau khi MCP server được thêm, bạn có thể bắt đầu sử dụng các tính năng tài liệu code cập nhật của Context7 trực tiếp trong Augment Code.
---

### **B. Cấu hình Thủ công**
1. Nhấn Cmd/Ctrl Shift P hoặc đi đến menu hamburger trong panel Augment
2. Chọn Edit Settings
3. Trong Advanced, click Edit in settings.json
4. Thêm cấu hình server vào mảng `mcpServers` trong object `augment.advanced`
"augment.advanced": {
"mcpServers": [
{
"name": "context7",
"command": "npx",
"args": ["-y", "@upstash/context7-mcp"]
}
]
}
Sau khi MCP server được thêm, khởi động lại editor của bạn. Nếu bạn nhận được bất kỳ lỗi nào, kiểm tra cú pháp để đảm bảo không thiếu dấu ngoặc đóng hoặc dấu phẩy.
</details>

<details>
<summary><b>Cài đặt trong Roo Code</b></summary>

Thêm cấu hình này vào file cấu hình Roo Code MCP của bạn. Xem [tài liệu Roo Code MCP](https://docs.roocode.com/features/mcp/using-mcp-in-roo) để biết thêm thông tin.

#### Kết nối Roo Code Remote Server

```json
{
  "mcpServers": {
    "context7": {
      "type": "streamable-http",
      "url": "https://mcp.context7.com/mcp"
    }
  }
}
```

#### Kết nối Roo Code Local Server

```json
{
  "mcpServers": {
    "context7": {
      "command": "npx",
      "args": ["-y", "@upstash/context7-mcp"]
    }
  }
}
```
</details>

<details>
<summary><b>Cài đặt trong Zencoder</b></summary>

Để cấu hình Context7 MCP trong Zencoder, làm theo các bước sau:
1. Đi đến menu Zencoder (...)
2. Từ menu dropdown, chọn Agent tools
3. Click vào Add custom MCP
4. Thêm tên và cấu hình server từ bên dưới, và đảm bảo nhấn nút Install
```json
{
  "command": "npx",
  "args": ["-y", "@upstash/context7-mcp@latest"]
}
```
Sau khi MCP server được thêm, bạn có thể dễ dàng tiếp tục sử dụng nó.
</details>

<details>
<summary><b>Cài đặt trong Amazon Q Developer CLI</b></summary>

Thêm cấu hình này vào file cấu hình Amazon Q Developer CLI của bạn. Xem [tài liệu Amazon Q Developer CLI](https://docs.aws.amazon.com/amazonq/latest/qdeveloper-ug/command-line-mcp-configuration.html) để biết thêm chi tiết.
```json
{
  "mcpServers": {
    "context7": {
      "command": "npx",
      "args": ["-y", "@upstash/context7-mcp@latest"]
    }
  }
}
```
</details>

<details>
<summary><b>Cài đặt trong Qodo Gen</b></summary>

Xem [tài liệu Qodo Gen](https://docs.qodo.ai/qodo-documentation/qodo-gen/qodo-gen-chat/agentic-mode/agentic-tools-mcps) để biết thêm chi tiết.
1. Mở panel chat Qodo Gen trong VSCode hoặc IntelliJ.
2. Click Connect more tools.
3. Click + Add new MCP.
4. Thêm cấu hình sau:
```json
{
  "mcpServers": {
    "context7": {
      "url": "https://mcp.context7.com/mcp"
    }
  }
}
```
</details>

<details>
<summary><b>Cài đặt trong JetBrains AI Assistant</b></summary>

Xem [Tài liệu JetBrains AI Assistant](https://www.jetbrains.com/help/ai-assistant/configure-an-mcp-server.html) để biết thêm chi tiết.
1. Trong JetBrains IDEs đi đến `Settings` -> `Tools` -> `AI Assistant` -> `Model Context Protocol (MCP)`
2. Click `+ Add`.
3. Click vào `Command` ở góc trên bên trái của dialog và chọn tùy chọn As JSON từ danh sách
4. Thêm cấu hình này và click `OK`
```json
{
  "mcpServers": {
    "context7": {
      "command": "npx",
      "args": ["-y", "@upstash/context7-mcp"]
    }
  }
}
```
5. Click `Apply` để lưu thay đổi.
6. Theo cách tương tự, context7 có thể được thêm cho JetBrains Junie trong `Settings` -> `Tools` -> `Junie` -> `MCP Settings`
</details>

<details>
<summary><b>Cài đặt trong Warp</b></summary>

Xem [Tài liệu Warp Model Context Protocol](https://docs.warp.dev/knowledge-and-collaboration/mcp#adding-an-mcp-server) để biết chi tiết.
1. Điều hướng `Settings` > `AI` > `Manage MCP servers`.
2. Thêm MCP server mới bằng cách click nút `+ Add`.
3. Paste cấu hình được cung cấp bên dưới:
```json
{
  "Context7": {
    "command": "npx",
    "args": ["-y", "@upstash/context7-mcp"],
    "env": {},
    "working_directory": null,
    "start_on_launch": true
  }
}
```
4. Click `Save` để áp dụng thay đổi.
</details>

<details>
<summary><b>Cài đặt trong Opencode</b></summary>

Thêm cấu hình này vào file cấu hình Opencode của bạn. Xem [tài liệu Opencode MCP](https://opencode.ai/docs/mcp-servers) để biết thêm thông tin.

#### Kết nối Opencode Remote Server

```json
"mcp": {
  "context7": {
    "type": "remote",
    "url": "https://mcp.context7.com/mcp",
    "enabled": true
  }
}
```

#### Kết nối Opencode Local Server

```json
{
  "mcp": {
    "context7": {
      "type": "local",
      "command": ["npx", "-y", "@upstash/context7-mcp"],
      "enabled": true
    }
  }
}
```
</details>

<details>
<summary><b>Cài đặt trong Copilot Coding Agent</b></summary>

## Sử dụng Context7 với Copilot Coding Agent
Thêm cấu hình sau vào phần `mcp` trong file cấu hình Copilot Coding Agent của bạn Repository->Settings->Copilot->Coding agent->MCP configuration:
```json
{
  "mcpServers": {
    "context7": {
      "type": "http",
      "url": "https://mcp.context7.com/mcp",
      "tools": ["query-docs", "resolve-library-id"]
    }
  }
}
```
Để biết thêm thông tin, xem [tài liệu GitHub chính thức](https://docs.github.com/en/enterprise-cloud@latest/copilot/how-tos/agents/copilot-coding-agent/extending-copilot-coding-agent-with-mcp).
</details>

<details>
<summary><b>Cài đặt trong Copilot CLI</b></summary>

1.  Mở file cấu hình MCP của Copilot CLI. Vị trí là `~/.copilot/mcp-config.json` (trong đó `~` là thư mục home của bạn).
2.  Thêm nội dung sau vào đối tượng `mcpServers` trong file `mcp-config.json` của bạn:
```json
{
  "mcpServers": {
    "context7": {
      "type": "http",
      "url": "https://mcp.context7.com/mcp",
      "headers": {
        "CONTEXT7_API_KEY": "YOUR_API_KEY"
      },
      "tools": ["query-docs", "resolve-library-id"]
    }
  }
}
```
Hoặc, đối với server cục bộ:
```json
{
  "mcpServers": {
    "context7": {
      "type": "local",
      "command": "npx",
      "tools": ["query-docs", "resolve-library-id"],
      "args": ["-y", "@upstash/context7-mcp", "--api-key", "YOUR_API_KEY"]
    }
  }
}
```
Nếu file `mcp-config.json` không tồn tại, hãy tạo nó.
</details>

<details>
<summary><b>Cài đặt trong Kiro</b></summary>

Xem [Tài liệu Kiro Model Context Protocol](https://kiro.dev/docs/mcp/configuration/) để biết chi tiết.
1. Điều hướng `Kiro` > `MCP Servers`
2. Thêm MCP server mới bằng cách click nút `+ Add`.
3. Paste cấu hình được cung cấp bên dưới:
```json
{
  "mcpServers": {
    "Context7": {
      "command": "npx",
      "args": ["-y", "@upstash/context7-mcp"],
      "env": {},
      "disabled": false,
      "autoApprove": []
    }
  }
}
```
4. Click `Save` để áp dụng thay đổi.
</details>

<details>
<summary><b>Cài đặt trong OpenAI Codex</b></summary>

Xem [OpenAI Codex](https://github.com/openai/codex) để biết thêm thông tin.
Thêm cấu hình sau vào cài đặt OpenAI Codex MCP server của bạn:

#### Kết nối Server Cục bộ

```toml
[mcp_servers.context7]
args = ["-y", "@upstash/context7-mcp"]
command = "npx"
```

#### Kết nối Server Từ xa

```toml
[mcp_servers.context7]
url = "https://mcp.context7.com/mcp"
http_headers = { "CONTEXT7_API_KEY" = "YOUR_API_KEY" }
```
</details>

<details>
<summary><b>Cài đặt trong LM Studio</b></summary>

Xem [LM Studio MCP Support](https://lmstudio.ai/blog/lmstudio-v0.3.17) để biết thêm thông tin.

#### Cài đặt một cú click:
[![Add MCP Server context7 to LM Studio](https://files.lmstudio.ai/deeplink/mcp-install-light.svg)](https://lmstudio.ai/install-mcp?name=context7&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkB1cHN0YXNoL2NvbnRleHQ3LW1jcCJdfQ%3D%3D)

#### Thiết lập thủ công:
1. Điều hướng đến `Program` (bên phải) > `Install` > `Edit mcp.json`.
2. Paste cấu hình được cung cấp bên dưới:
```json
{
  "mcpServers": {
    "Context7": {
      "command": "npx",
      "args": ["-y", "@upstash/context7-mcp"]
    }
  }
}
```
3. Click `Save` để áp dụng thay đổi.
4. Bật/tắt MCP server từ bên phải, dưới `Program`, hoặc bằng cách click biểu tượng plug ở cuối hộp chat.
</details>

## 🔨 Công Cụ Có Sẵn
Context7 MCP cung cấp các công cụ sau mà LLM có thể sử dụng:
- `resolve-library-id`: Chuyển đổi tên thư viện chung thành Context7-compatible library ID.
  - `query` (bắt buộc): Câu hỏi hoặc nhiệm vụ của người dùng (để xếp hạng độ liên quan)
  - `libraryName` (bắt buộc): Tên của thư viện cần tìm kiếm
- `query-docs`: Lấy tài liệu cho thư viện sử dụng Context7-compatible library ID.
  - `libraryId` (bắt buộc): Context7-compatible library ID chính xác (ví dụ: `/mongodb/docs`, `/vercel/next.js`)
  - `query` (bắt buộc): Câu hỏi hoặc nhiệm vụ để lấy tài liệu liên quan

## 🛟 Mẹo

### Thêm Quy Tắc
> Nếu bạn không muốn thêm `use context7` vào mỗi prompt, bạn có thể định nghĩa một quy tắc đơn giản trong file `.windsurfrules` của bạn trong Windsurf hoặc từ phần `Cursor Settings > Rules` trong Cursor (hoặc tương đương trong MCP client của bạn) để tự động gọi Context7 trên bất kỳ câu hỏi code nào:
>
> ```toml
> [[calls]]
> match = "when the user requests code examples, setup or configuration steps, or library/API documentation"
> tool  = "context7"
> ```
>
> Từ đó bạn sẽ nhận được tài liệu Context7 trong bất kỳ cuộc hội thoại liên quan nào mà không cần gõ thêm gì. Bạn có thể thêm các trường hợp sử dụng của mình vào phần match.

### Sử dụng Library Id
> Nếu bạn đã biết chính xác thư viện nào muốn sử dụng, hãy thêm Context7 ID của nó vào prompt của bạn. Cách đó, Context7 MCP server có thể bỏ qua bước matching thư viện và trực tiếp tiếp tục với việc lấy tài liệu.
>
> ```txt
> implement basic authentication with supabase. use library /supabase/supabase for api and docs
> ```
>
> Cú pháp dấu gạch chéo nói với MCP tool chính xác thư viện nào cần load tài liệu.

## 💻 Phát Triển
Clone dự án và cài đặt dependencies:
```bash
pnpm i
```
Build:
```bash
pnpm run build
```
Chạy server:
```bash
node packages/mcp/dist/index.js
```

### Tham Số CLI
`context7-mcp` chấp nhận các CLI flags sau:
- `--transport <stdio|http>` – Transport để sử dụng (`stdio` theo mặc định).
- `--port <number>` – Port để lắng nghe khi sử dụng transport `http` (mặc định `3000`).
Ví dụ với http transport và port 8080:
```bash
node packages/mcp/dist/index.js --transport http --port 8080
```
<details>
<summary><b>Ví dụ Cấu hình Local</b></summary>

```json
{
  "mcpServers": {
    "context7": {
      "command": "npx",
      "args": ["tsx", "/path/to/folder/context7-mcp/src/index.ts"]
    }
  }
}
```
</details>

<details>
<summary><b>Test với MCP Inspector</b></summary>

```bash
npx -y @modelcontextprotocol/inspector npx @upstash/context7-mcp
```
</details>

## 🚨 Khắc Phục Sự Cố
<details>
<summary><b>Lỗi Module Not Found</b></summary>

Nếu bạn gặp `ERR_MODULE_NOT_FOUND`, thử sử dụng `bunx` thay vì `npx`:
```json
{
  "mcpServers": {
    "context7": {
      "command": "bunx",
      "args": ["-y", "@upstash/context7-mcp"]
    }
  }
}
```
Điều này thường giải quyết các vấn đề phân giải module trong môi trường mà `npx` không cài đặt hoặc phân giải packages đúng cách.
</details>

<details>
<summary><b>Vấn đề ESM Resolution</b></summary>

Đối với lỗi như `Error: Cannot find module 'uriTemplate.js'`, thử flag `--experimental-vm-modules`:
```json
{
  "mcpServers": {
    "context7": {
      "command": "npx",
      "args": ["-y", "--node-options=--experimental-vm-modules", "@upstash/context7-mcp@1.0.6"]
    }
  }
}
```
</details>

<details>
<summary><b>Vấn đề TLS/Certificate</b></summary>

Sử dụng flag `--experimental-fetch` để vượt qua các vấn đề liên quan đến TLS:
```json
{
  "mcpServers": {
    "context7": {
      "command": "npx",
      "args": ["-y", "--node-options=--experimental-fetch", "@upstash/context7-mcp"]
    }
  }
}
```
</details>

<details>
<summary><b>Lỗi MCP Client Chung</b></summary>

1. Thử thêm `@latest` vào tên package
2. Sử dụng `bunx` như một thay thế cho `npx`
3. Cân nhắc sử dụng `deno` như một thay thế khác
4. Đảm bảo bạn đang sử dụng Node.js v18 trở lên để hỗ trợ native fetch
</details>

## ⚠️ Tuyên Bố Miễn Trừ Trách Nhiệm
Các dự án Context7 được đóng góp bởi cộng đồng và mặc dù chúng tôi cố gắng duy trì chất lượng cao, chúng tôi không thể đảm bảo tính chính xác, đầy đủ hoặc bảo mật của tất cả tài liệu thư viện. Các dự án được liệt kê trong Context7 được phát triển và duy trì bởi các chủ sở hữu tương ứng của họ, không phải bởi Context7. Nếu bạn gặp bất kỳ nội dung đáng ngờ, không phù hợp hoặc có khả năng gây hại nào, vui lòng sử dụng nút "Report" trên trang dự án để thông báo cho chúng tôi ngay lập tức. Chúng tôi xem xét tất cả các báo cáo một cách nghiêm túc và sẽ xem xét nội dung được gắn cờ kịp thời để duy trì tính toàn vẹn và an toàn của nền tảng. Bằng cách sử dụng Context7, bạn thừa nhận rằng bạn làm như vậy theo quyết định và rủi ro của riêng mình.

## 🤝 Kết Nối Với Chúng Tôi
Cập nhật và tham gia cộng đồng của chúng tôi:
- 📢 Theo dõi chúng tôi trên [X](https://x.com/context7ai) để có tin tức và cập nhật mới nhất
- 🌐 Truy cập [Website](https://context7.com) của chúng tôi
- 💬 Tham gia [Discord Community](https://upstash.com/discord) của chúng tôi

## 📺 Context7 Trên Truyền Thông
- [Better Stack: "Free Tool Makes Cursor 10x Smarter"](https://youtu.be/52FC3qObp9E)
- [Cole Medin: "This is Hands Down the BEST MCP Server for AI Coding Assistants"](https://www.youtube.com/watch?v=G7gK8H6u7Rs)
- [Income Stream Surfers: "Context7 + SequentialThinking MCPs: Is This AGI?"](https://www.youtube.com/watch?v=-ggvzyLpK6o)
- [Julian Goldie SEO: "Context7: New MCP AI Agent Update"](https://www.youtube.com/watch?v=CTZm6fBYisc)
- [JeredBlu: "Context 7 MCP: Get Documentation Instantly + VS Code Setup"](https://www.youtube.com/watch?v=-ls0D-rtET4)
- [Income Stream Surfers: "Context7: The New MCP Server That Will CHANGE AI Coding"](https://www.youtube.com/watch?v=PS-2Azb-C3M)
- [AICodeKing: "Context7 + Cline & RooCode: This MCP Server Makes CLINE 100X MORE EFFECTIVE!"](https://www.youtube.com/watch?v=qZfENAPMnyo)
- [Sean Kochel: "5 MCP Servers For Vibe Coding Glory (Just Plug-In & Go)"](https://www.youtube.com/watch?v=LqTQi8qexJM)

## ⭐ Lịch Sử Star
[![Star History Chart](https://api.star-history.com/svg?repos=upstash/context7&type=Date)](https://www.star-history.com/#upstash/context7&Date)

## 📄 Giấy Phép
MIT
