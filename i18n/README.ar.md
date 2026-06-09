# Context7 MCP - توثيق أكواد محدث لأي أمر برمجي

[![Website](https://img.shields.io/badge/Website-context7.com-blue)](https://context7.com) [![smithery badge](https://smithery.ai/badge/@upstash/context7-mcp)](https://smithery.ai/server/@upstash/context7-mcp) [<img alt="Install in VS Code (npx)" src="https://img.shields.io/badge/VS_Code-VS_Code?style=flat-square&label=Install%20Context7%20MCP&color=0098FF">](https://insiders.vscode.dev/redirect?url=vscode%3Amcp%2Finstall%3F%7B%22name%22%3A%22context7%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40upstash%2Fcontext7-mcp%40latest%22%5D%7D)

## ❌ بدون Context7

تعتمد النماذج اللغوية الكبيرة على معلومات قديمة أو عامة حول المكتبات التي تستخدمها. مما يؤدي إلى:

- ❌ أمثلة أكواد قديمة مبنية على بيانات تدريب مضى عليها وقت طويل
- ❌ واجهات برمجة تطبيقات وهمية غير موجودة
- ❌ إجابات عامة لنسخ قديمة من الحزم

## ✅ مع Context7

يستخرج Context7 MCP التوثيق والأمثلة البرمجية المحدثة مباشرة من المصدر — ويضعها في طلبك للنموذج.
أضف `use context7` إلى طلبك في Cursor:

```txt
أنشئ مشروع Next.js بسيط باستخدام app router. use context7
```

```txt
أنشئ سكربت لحذف الصفوف التي تكون فيها المدينة فارغة "" باستخدام بيانات اعتماد PostgreSQL. use context7
```

يقوم Context7 بجلب الأمثلة المحدثة والتوثيق المناسب مباشرة إلى السياق.

- 1️⃣ اكتب طلبك بشكل طبيعي
- 2️⃣ أخبر النموذج بـ `use context7`
- 3️⃣ احصل على أكواد تعمل مباشرة
  لا حاجة للتنقل بين التبويبات، لا واجهات برمجة تطبيقات وهمية، لا أكواد قديمة.

## 🛠️ البدء

### المتطلبات

- Node.js إصدار 18.0.0 أو أعلى
- Cursor، Devin Desktop، Claude Desktop أو أي عميل MCP آخر

### التثبيت عبر Smithery

لتثبيت Context7 MCP Server تلقائيًا لـ Claude Desktop:

```bash
npx -y @smithery/cli install @upstash/context7-mcp --client claude
```

### التثبيت في Cursor

اذهب إلى: `Settings` -> `Cursor Settings` -> `MCP` -> `Add new global MCP server`
أو أضف هذا إلى ملف `~/.cursor/mcp.json`:

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

### التثبيت باستخدام Bun

```json
{
  "mcpServers": {
    "context7": {
      "command": "bunx",
      "args": ["-y", "@upstash/context7-mcp@latest"]
    }
  }
}
```

### التثبيت باستخدام Deno

```json
{
  "mcpServers": {
    "context7": {
      "command": "deno",
      "args": ["run", "--allow-env", "--allow-net", "npm:@upstash/context7-mcp"]
    }
  }
}
```

### التثبيت في Devin Desktop

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

### التثبيت في VS Code

```json
{
  "servers": {
    "Context7": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@upstash/context7-mcp@latest"]
    }
  }
}
```

### التثبيت في Zed

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

### التثبيت في Claude Code

```sh
claude mcp add --scope user context7 -- npx -y @upstash/context7-mcp@latest
```

### التثبيت في Claude Desktop

```json
{
  "mcpServers": {
    "Context7": {
      "command": "npx",
      "args": ["-y", "@upstash/context7-mcp@latest"]
    }
  }
}
```

### التثبيت في BoltAI

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

### التثبيت في Copilot Coding Agent

أضف التكوين التالي إلى قسم `mcp` في ملف إعدادات Copilot Coding Agent الخاص بك Repository->Settings->Copilot->Coding agent->MCP configuration:

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

لمزيد من المعلومات، راجع [التوثيق الرسمي على GitHub](https://docs.github.com/en/enterprise-cloud@latest/copilot/how-tos/agents/copilot-coding-agent/extending-copilot-coding-agent-with-mcp).

### باستخدام Docker

**Dockerfile:**

```Dockerfile
FROM node:18-alpine
WORKDIR /app
RUN npm install -g @upstash/context7-mcp@latest
CMD ["context7-mcp"]
```

**بناء الصورة:**

```bash
docker build -t context7-mcp .
```

**التهيئة داخل العميل:**

```json
{
  "mcpServers": {
    "Context7": {
      "command": "docker",
      "args": ["run", "-i", "--rm", "context7-mcp"],
      "transportType": "stdio"
    }
  }
}
```

### التثبيت في Windows

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

### الأدوات المتوفرة

- `resolve-library-id`: يحول اسم مكتبة عام إلى معرف متوافق مع Context7.
  - `query` (مطلوب): سؤال أو مهمة المستخدم (لترتيب الصلة)
  - `libraryName` (مطلوب): اسم المكتبة للبحث عنها
- `query-docs`: يستخرج التوثيق حسب المعرف.
  - `libraryId` (مطلوب): معرف Context7 المتوافق الدقيق (مثل `/mongodb/docs`, `/vercel/next.js`)
  - `query` (مطلوب): السؤال أو المهمة للحصول على توثيق ذي صلة

## التطوير

```bash
pnpm i
pnpm run build
```

**التهيئة المحلية:**

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

**الاختبار باستخدام MCP Inspector:**

```bash
npx -y @modelcontextprotocol/inspector npx @upstash/context7-mcp@latest
```

## استكشاف الأخطاء

### ERR_MODULE_NOT_FOUND

استخدم `bunx` بدلاً من `npx`.

```json
{
  "mcpServers": {
    "context7": {
      "command": "bunx",
      "args": ["-y", "@upstash/context7-mcp@latest"]
    }
  }
}
```

### مشاكل في ESM

جرّب إضافة:

```json
{
  "command": "npx",
  "args": ["-y", "--node-options=--experimental-vm-modules", "@upstash/context7-mcp@1.0.6"]
}
```

### أخطاء عميل MCP

1. أزل `@latest`
2. جرّب `bunx`
3. جرّب `deno`
4. تأكد أنك تستخدم Node v18 أو أحدث

## إخلاء مسؤولية

المشاريع المدرجة في Context7 مساهم بها من المجتمع، ولا يمكن ضمان دقتها أو أمانها بشكل كامل. الرجاء الإبلاغ عن أي محتوى مريب باستخدام زر "الإبلاغ".

## Context7 في الإعلام

- [Better Stack: "أداة مجانية تجعل Cursor أذكى 10x"](https://youtu.be/52FC3qObp9E)
- [Cole Medin: "أفضل MCP Server لمساعدين الذكاء الاصطناعي البرمجيين"](https://www.youtube.com/watch?v=G7gK8H6u7Rs)
- [Context7 + SequentialThinking: هل هذا AGI؟](https://www.youtube.com/watch?v=-ggvzyLpK6o)
- [تحديث جديد من Context7 MCP](https://www.youtube.com/watch?v=CTZm6fBYisc)
- [إعداد Context7 في VS Code](https://www.youtube.com/watch?v=-ls0D-rtET4)
- [Context7: MCP جديد سيغير البرمجة](https://www.youtube.com/watch?v=PS-2Azb-C3M)
- [Cline & RooCode + Context7: قوة مضاعفة](https://www.youtube.com/watch?v=qZfENAPMnyo)
- [أفضل 5 MCP Servers لتجربة برمجة ساحرة](https://www.youtube.com/watch?v=LqTQi8qexJM)

## سجل النجوم

[![Star History Chart](https://api.star-history.com/svg?repos=upstash/context7&type=Date)](https://www.star-history.com/#upstash/context7&Date)

## الترخيص

MIT
