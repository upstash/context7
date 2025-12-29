# Context7 MCP - Documentación Actualizada Para Cualquier Prompt

[![Sitio Web](https://img.shields.io/badge/Website-context7.com-blue)](https://context7.com) [![insignia smithery](https://smithery.ai/badge/@upstash/context7-mcp)](https://smithery.ai/server/@upstash/context7-mcp) [<img alt="Instalar en VS Code (npx)" src="https://img.shields.io/badge/VS_Code-VS_Code?style=flat-square&label=Instalar%20Context7%20MCP&color=0098FF">](https://insiders.vscode.dev/redirect?url=vscode%3Amcp%2Finstall%3F%257B%2522name%2522%253A%2522context7%2522%252C%2522config%2522%253A%257B%2522command%2522%253A%2522npx%2522%252C%2522args%2522%253A%255B%2522-y%2522%252C%2522%2540upstash%252Fcontext7-mcp%2540latest%2522%255D%257D%257D)

## ❌ Sin Context7

Los LLMs dependen de información desactualizada o genérica sobre las bibliotecas que utilizas. Obtienes:

- ❌ Ejemplos de código desactualizados y basados en datos de entrenamiento de hace un año
- ❌ APIs inventadas que ni siquiera existen
- ❌ Respuestas genéricas para versiones antiguas de paquetes

## ✅ Con Context7

El Context7 MCP obtiene documentación y ejemplos de código actualizados y específicos de la versión directamente desde la fuente, y los coloca directamente en tu prompt.
Añade `use context7` a tu prompt en Cursor:

```txt
Crea un proyecto básico de Next.js con app router. use context7
```

```txt
Crea un script para eliminar las filas donde la ciudad es "" dadas las credenciales de PostgreSQL. use context7
```

Context7 obtiene ejemplos de código y documentación actualizados directamente en el contexto de tu LLM.

- 1️⃣ Escribe tu prompt de forma natural
- 2️⃣ Dile al LLM que `use context7`
- 3️⃣ Obtén respuestas de código que funcionan
  Sin cambiar de pestaña, sin APIs inventadas que no existen, sin generaciones de código desactualizadas.

## 🛠️ Empezando

### Requisitos

- Node.js >= v18.0.0
- Cursor, Windsurf, Claude Desktop u otro Cliente MCP

### Instalando vía Smithery

Para instalar Context7 MCP Server para Claude Desktop automáticamente vía [Smithery](https://smithery.ai/server/@upstash/context7-mcp):

```bash
npx -y @smithery/cli install @upstash/context7-mcp --client claude
```

### Instalar en Cursor

Ve a: `Settings` -> `Cursor Settings` -> `MCP` -> `Add new global MCP server`
Pegar la siguiente configuración en tu archivo `~/.cursor/mcp.json` de Cursor es el metodo recomendado. Consulta la [documentación de MCP de Cursor](https://docs.cursor.com/context/model-context-protocol) para más información.

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

<details>
<summary>Alternativa: Usar Bun</summary>
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
</details>
<details>
<summary>Alternativa: Usar Deno</summary>
```json
{
  "mcpServers": {
    "context7": {
      "command": "deno",
      "args": ["run", "--allow-net", "npm:@upstash/context7-mcp"]
    }
  }
}
```
</details>
### Instalar en Windsurf
Añade esto a tu archivo de configuración MCP de Windsurf. Consulta la [documentación de MCP de Windsurf](https://docs.windsurf.com/windsurf/mcp) para más información.
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
### Instalar en VS Code
[<img alt="Instalar en VS Code (npx)" src="https://img.shields.io/badge/VS_Code-VS_Code?style=flat-square&label=Instalar%20Context7%20MCP&color=0098FF">](https://insiders.vscode.dev/redirect?url=vscode%3Amcp%2Finstall%3F%257B%2522name%2522%253A%2522context7%2522%252C%2522config%2522%253A%257B%2522command%2522%253A%2522npx%2522%252C%2522args%2522%253A%255B%2522-y%2522%252C%2522%2540upstash%252Fcontext7-mcp%2540latest%2522%255D%257D%257D)
[<img alt="Instalar en VS Code Insiders (npx)" src="https://img.shields.io/badge/VS_Code_Insiders-VS_Code_Insiders?style=flat-square&label=Instalar%20Context7%20MCP&color=24bfa5">](https://insiders.vscode.dev/redirect?url=vscode-insiders%3Amcp%2Finstall%3F%257B%2522name%2522%253A%2522context7%2522%252C%2522config%2522%253A%257B%2522command%2522%253A%2522npx%2522%252C%2522args%2522%253A%255B%2522-y%2522%252C%2522%2540upstash%252Fcontext7-mcp%2540latest%2522%255D%257D%257D)
Añade esto a tu archivo de configuración MCP de VS Code. Consulta la [documentación de VS Code MCP](https://code.visualstudio.com/docs/copilot/chat/mcp-servers) para más información.
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
### Instalar en Claude Code
Ejecuta este comando. Consulta la [documentación de MCP de Claude Code](https://docs.anthropic.com/es/docs/claude-code/mcp) para más información.
```sh
claude mcp add context7 -- npx -y @upstash/context7-mcp@latest
```
### Instalar en Claude Desktop
Añade esto a tu archivo `claude_desktop_config.json` de Claude Desktop. Consulta la [documentación de MCP de Claude Desktop](https://modelcontextprotocol.io/quickstart/user) para más información.
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
### Instalar en Copilot Coding Agent
Agrega la siguiente configuración a la sección `mcp` de tu archivo de configuración de Copilot Coding Agent (Repository->Settings->Copilot->Coding agent->MCP configuration):
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
Para más información, consulta la [documentación oficial de GitHub](https://docs.github.com/en/enterprise-cloud@latest/copilot/how-tos/agents/copilot-coding-agent/extending-copilot-coding-agent-with-mcp).
### Instalar en Copilot CLI
1.  Abre el archivo de configuración MCP de Copilot CLI. La ubicación es `~/.copilot/mcp-config.json` (donde `~` es tu directorio home).
2.  Agrega lo siguiente al objeto `mcpServers` en tu archivo `mcp-config.json`:
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
O, para un servidor local:
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
Si el archivo `mcp-config.json` no existe, créalo.
### Herramientas Disponibles
- `resolve-library-id`: Resuelve un nombre de una biblioteca general en un ID de biblioteca compatible con Context7.
  - `query` (requerido): La pregunta o tarea del usuario (para ranking de relevancia)
  - `libraryName` (requerido): El nombre de la biblioteca a buscar
- `query-docs`: Obtiene documentación para una biblioteca utilizando un ID de biblioteca compatible con Context7.
  - `libraryId` (requerido): ID exacto compatible con Context7 (por ejemplo, `/mongodb/docs`, `/vercel/next.js`)
  - `query` (requerido): La pregunta o tarea para obtener documentación relevante
## Desarrollo
Clona el proyecto e instala las dependencias:
```bash
pnpm i
```
Compila:
```bash
pnpm run build
```
### Ejemplo de Configuración Local
```json
{
  "mcpServers": {
    "context7": {
      "command": "npx",
      "args": ["tsx", "/ruta/a/la/carpeta/context7-mcp/src/index.ts"]
    }
  }
}
```
### Probando con MCP Inspector
```bash
npx -y @modelcontextprotocol/inspector npx @upstash/context7-mcp@latest
```
## Solución de Problemas
### ERR_MODULE_NOT_FOUND
Si ves este error, intenta usar `bunx` en lugar de `npx`.
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
Esto a menudo resuelve problemas de resolución de módulos, especialmente en entornos donde `npx` no instala o resuelve paquetes correctamente.
### Errores del Cliente MCP
1. Intenta eliminar `@latest` del nombre del paquete.
2. Intenta usar `bunx` como alternativa.
3. Intenta usar `deno` como alternativa.
## Context7 en los Medios
- [Better Stack: "Free Tool Makes Cursor 10x Smarter"](https://youtu.be/52FC3qObp9E)
- [Cole Medin: "This is Hands Down the BEST MCP Server for AI Coding Assistants"](https://www.youtube.com/watch?v=G7gK8H6u7Rs)
- [Income stream surfers: "Context7 + SequentialThinking MCPs: Is This AGI?"](https://www.youtube.com/watch?v=-ggvzyLpK6o)
- [Julian Goldie SEO: "Context7: New MCP AI Agent Update"](https://www.youtube.com/watch?v=CTZm6fBYisc)
- [JeredBlu: "Context 7 MCP: Get Documentation Instantly + VS Code Setup"](https://www.youtube.com/watch?v=-ls0D-rtET4)
- [Income stream surfers: "Context7: The New MCP Server That Will CHANGE AI Coding"](https://www.youtube.com/watch?v=PS-2Azb-C3M)
## Historial de Estrellas
[![Gráfico de Historial de Estrellas](https://api.star-history.com/svg?repos=upstash/context7&type=Date)](https://www.star-history.com/#upstash/context7&Date)
## Licencia
MIT
