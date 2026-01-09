# Context7 MCP - Documentação de Código Atualizada para Qualquer Prompt

[![Website](https://img.shields.io/badge/Website-context7.com-blue)](https://context7.com) [![smithery badge](https://smithery.ai/badge/@upstash/context7-mcp)](https://smithery.ai/server/@upstash/context7-mcp)
[<img alt="Instalar no Cursor" src="https://img.shields.io/badge/Instalar%20no%20CURSOR-000000?style=for-the-badge&logo=cursor&logoColor=white">](https://cursor.com/en/install-mcp?name=context7&config=eyJ1cmwiOiJodHRwczovL21jcC5jb250ZXh0Ny5jb20vbWNwIn0%3D) [<img alt="Instalar no VS Code (npx)" src="https://img.shields.io/badge/Instalar%20no%20VS%20Code-0098FF?style=for-the-badge&logo=visualstudiocode&logoColor=white">](https://insiders.vscode.dev/redirect?url=vscode%3Amcp%2Finstall%3F%7B%22name%22%3A%22context7%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40upstash%2Fcontext7-mcp%40latest%22%5D%7D)
[![Documentation in English](https://img.shields.io/badge/docs-English-purple)](../README.md) [![繁體中文](https://img.shields.io/badge/docs-繁體中文-yellow)](./README.zh-TW.md) [![简体中文](https://img.shields.io/badge/docs-简体中文-yellow)](./README.zh-CN.md) [![日本語](https://img.shields.io/badge/docs-日本語-b7003a)](./README.ja.md) [![한국어 문서](https://img.shields.io/badge/docs-한국어-green)](./README.ko.md) [![Documentación en Español](https://img.shields.io/badge/docs-Español-orange)](./README.es.md) [![Documentation en Français](https://img.shields.io/badge/docs-Français-blue)](./README.fr.md) [![Documentazione in italiano](https://img.shields.io/badge/docs-Italian-red)](./README.it.md) [![Dokumentasi Bahasa Indonesia](https://img.shields.io/badge/docs-Bahasa%20Indonesia-pink)](./README.id-ID.md) [![Dokumentation auf Deutsch](https://img.shields.io/badge/docs-Deutsch-darkgreen)](./README.de.md) [![Документация на русском языке](https://img.shields.io/badge/docs-Русский-darkblue)](./README.ru.md) [![Українська документація](https://img.shields.io/badge/docs-Українська-lightblue)](./README.uk.md) [![Türkçe Doküman](https://img.shields.io/badge/docs-Türkçe-blue)](./README.tr.md) [![Arabic Documentation](https://img.shields.io/badge/docs-Arabic-white)](./README.ar.md) [![Tiếng Việt](https://img.shields.io/badge/docs-Tiếng%20Việt-red)](./README.vi.md)

## ❌ Sem o Context7

Os LLMs dependem de informações desatualizadas ou genéricas sobre as bibliotecas que você usa. Você obtém:

- ❌ Exemplos de código desatualizados e baseados em dados de treinamento de anos atrás
- ❌ APIs alucinadas que nem existem
- ❌ Respostas genéricas para versões antigas de pacotes

## ✅ Com o Context7

O Context7 MCP extrai documentação e exemplos de código atualizados e específicos para cada versão diretamente da fonte — e os coloca diretamente em seu prompt.
Adicione `use context7` ao seu prompt no Cursor:

```txt
Create a basic Next.js project with app router. use context7
```

```txt
Create a script to delete the rows where the city is "" given PostgreSQL credentials. use context7
```

O Context7 busca exemplos de código e documentação atualizados diretamente para o contexto do seu LLM.

- 1️⃣ Escreva seu prompt naturalmente
- 2️⃣ Diga ao LLM `use context7`
- 3️⃣ Obtenha respostas com código funcional
  Sem alternar entre abas, sem APIs alucinadas que não existem, sem gerações de código desatualizadas.

## 📚 Adicionando Projetos

Confira nosso [guia de adição de projetos](./adding-projects.md) para aprender como adicionar (ou atualizar) suas bibliotecas favoritas ao Context7.

## 🛠️ Instalação

### Requisitos

- Node.js >= v18.0.0
- Cursor, Claude Code, VSCode, Windsurf ou outro Cliente MCP
<details>
<summary><b>Instalando via Smithery</b></summary>
Para instalar o Context7 MCP Server automaticamente em qualquer cliente via [Smithery](https://smithery.ai/server/@upstash/context7-mcp):

```bash
npx -y @smithery/cli@latest install @upstash/context7-mcp --client <CLIENT_NAME> --key <YOUR_SMITHERY_KEY>
```

Você pode encontrar sua chave Smithery na [página do Smithery.ai](https://smithery.ai/server/@upstash/context7-mcp).

</details>
<details>
<summary><b>Instalar no Cursor</b></summary>
Vá em: `Settings` -> `Cursor Settings` -> `MCP` -> `Add new global MCP server`
Colar a seguinte configuração no arquivo `~/.cursor/mcp.json` do Cursor é a abordagem recomendada. Você também pode instalar em um projeto específico criando `.cursor/mcp.json` na pasta do seu projeto. Veja mais em [Cursor MCP docs](https://docs.cursor.com/context/model-context-protocol).
> Desde o Cursor 1.0, você pode clicar no botão de instalar abaixo para uma instalação instantânea com um clique.
#### Conexão Remota do Servidor Cursor
[![Install MCP Server](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/en/install-mcp?name=context7&config=eyJ1cmwiOiJodHRwczovL21jcC5jb250ZXh0Ny5jb20vbWNwIn0%3D)
```json
{
  "mcpServers": {
    "context7": {
      "url": "https://mcp.context7.com/mcp"
    }
  }
}
```
#### Conexão Local do Servidor Cursor
[![Install MCP Server](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/en/install-mcp?name=context7&config=eyJjb21tYW5kIjoibnB4IC15IEB1cHN0YXNoL2NvbnRleHQ3LW1jcCJ9)
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
<summary><b>Instalar no Claude Code</b></summary>
Execute este comando. Veja mais em [Claude Code MCP docs](https://docs.anthropic.com/pt/docs/claude-code/mcp).
#### Conexão Local do Servidor Claude Code
```sh
claude mcp add context7 -- npx -y @upstash/context7-mcp
```
#### Conexão Remota do Servidor Claude Code
```sh
claude mcp add --transport http context7 https://mcp.context7.com/mcp
```
</details>
<details>
<summary><b>Instalar no Windsurf</b></summary>
Adicione isto ao arquivo de configuração MCP do Windsurf. Veja mais em [Windsurf MCP docs](https://docs.windsurf.com/windsurf/cascade/mcp).
#### Conexão Remota do Servidor Windsurf
```json
{
  "mcpServers": {
    "context7": {
      "serverUrl": "https://mcp.context7.com/mcp"
    }
  }
}
```
#### Conexão Local do Servidor Windsurf
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
<summary><b>Instalar no VS Code</b></summary>
[<img alt="Install in VS Code (npx)" src="https://img.shields.io/badge/VS_Code-VS_Code?style=flat-square&label=Install%20Context7%20MCP&color=0098FF">](https://insiders.vscode.dev/redirect?url=vscode%3Amcp%2Finstall%3F%7B%22name%22%3A%22context7%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40upstash%2Fcontext7-mcp%40latest%22%5D%7D)
[<img alt="Install in VS Code Insiders (npx)" src="https://img.shields.io/badge/VS_Code_Insiders-VS_Code_Insiders?style=flat-square&label=Install%20Context7%20MCP&color=24bfa5">](https://insiders.vscode.dev/redirect?url=vscode-insiders%3Amcp%2Finstall%3F%7B%22name%22%3A%22context7%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40upstash%2Fcontext7-mcp%40latest%22%5D%7D)
Adicione isto ao arquivo de configuração MCP do VS Code. Veja mais em [VS Code MCP docs](https://code.visualstudio.com/docs/copilot/chat/mcp-servers).
#### Conexão Remota do Servidor VS Code
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
#### Conexão Local do Servidor VS Code
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
<summary>
<b>Instalar no Cline</b>
</summary>
Você pode instalar o Context7 facilmente pelo [Cline MCP Server Marketplace](https://cline.bot/mcp-marketplace) seguindo estas instruções:
1. Abra o **Cline**.
2. Clique no ícone de menu (☰) para entrar na seção **MCP Servers**.
3. Use a barra de busca na aba **Marketplace** para encontrar _Context7_.
4. Clique no botão **Install**.
</details>
<details>
<summary><b>Instalar no Zed</b></summary>
Pode ser instalado via [Zed Extensions](https://zed.dev/extensions?query=Context7) ou você pode adicionar isto ao seu `settings.json` do Zed. Veja mais em [Zed Context Server docs](https://zed.dev/docs/assistant/context-servers).
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
<summary><b>Instalar no Augment Code</b></summary>
Para configurar o Context7 MCP no Augment Code, você pode usar a interface gráfica ou a configuração manual.
### **A. Usando a UI do Augment Code**
1. Clique no menu hambúrguer.
2. Selecione **Settings**.
3. Navegue até a seção **Tools**.
4. Clique no botão **+ Add MCP**.
5. Insira o seguinte comando:
   ```
   npx -y @upstash/context7-mcp@latest
   ```
6. Nomeie o MCP: **Context7**.
7. Clique no botão **Add**.
Depois que o servidor MCP for adicionado, você pode começar a usar os recursos de documentação de código atualizada do Context7 diretamente no Augment Code.
---
### **B. Configuração Manual**
1. Pressione Cmd/Ctrl Shift P ou vá ao menu hambúrguer no painel do Augment
2. Selecione Edit Settings
3. Em Advanced, clique em Edit em settings.json
4. Adicione a configuração do servidor ao array `mcpServers` no objeto `augment.advanced`
```json
"augment.advanced": {
  "mcpServers": [
    {
      "name": "context7",
      "command": "npx",
      "args": ["-y", "@upstash/context7-mcp"]
    }
  ]
}
```
Depois de adicionar o servidor MCP, reinicie seu editor. Se você receber algum erro, verifique a sintaxe para garantir que colchetes ou vírgulas não estejam faltando.
</details>
<details>
<summary><b>Instalar no Roo Code</b></summary>
Adicione isto ao arquivo de configuração MCP do Roo Code. Veja mais em [Roo Code MCP docs](https://docs.roocode.com/features/mcp/using-mcp-in-roo).
#### Conexão Remota do Servidor Roo Code
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
#### Conexão Local do Servidor Roo Code
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
<summary><b>Instalar no Gemini CLI</b></summary>
Veja os detalhes em [Configuração do Gemini CLI](https://google-gemini.github.io/gemini-cli/docs/tools/mcp-server.html).
1. Abra o arquivo de configurações do Gemini CLI. A localização é `~/.gemini/settings.json` (onde `~` é o seu diretório home).
2. Adicione o seguinte ao objeto `mcpServers` no seu arquivo `settings.json`:
```json
{
  "mcpServers": {
    "context7": {
      "httpUrl": "https://mcp.context7.com/mcp"
    }
  }
}
```
Ou, para um servidor local:
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
Se o objeto `mcpServers` não existir, crie-o.
</details>
<details>
<summary><b>Instalar no Claude Desktop</b></summary>
#### Conexão Remota
Abra o Claude Desktop e navegue até Settings > Connectors > Add Custom Connector. Insira o nome como `Context7` e a URL remota do MCP server como `https://mcp.context7.com/mcp`.
#### Conexão Local
Abra as configurações de desenvolvedor do Claude Desktop e edite seu arquivo `claude_desktop_config.json` para adicionar a seguinte configuração. Veja mais em [Claude Desktop MCP docs](https://modelcontextprotocol.io/quickstart/user).
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
<summary><b>Instalar no Opencode</b></summary>
Adicione isto ao arquivo de configuração do Opencode. Veja mais em [Opencode MCP docs](https://opencode.ai/docs/mcp-servers).
#### Conexão Remota do Opencode
```json
"mcp": {
  "context7": {
    "type": "remote",
    "url": "https://mcp.context7.com/mcp",
    "enabled": true
  }
}
```
#### Conexão Local do Opencode
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
<summary><b>Instalar no OpenAI Codex</b></summary>
Veja mais em [OpenAI Codex](https://github.com/openai/codex).
Adicione a seguinte configuração às definições do servidor MCP do OpenAI Codex:
#### Conexão de Servidor Local
```toml
[mcp_servers.context7]
args = ["-y", "@upstash/context7-mcp"]
command = "npx"
```
#### Conexão de Servidor Remoto
```toml
[mcp_servers.context7]
url = "https://mcp.context7.com/mcp"
http_headers = { "CONTEXT7_API_KEY" = "YOUR_API_KEY" }
```
</details>
<details>
<summary><b>Instalar no JetBrains AI Assistant</b></summary>
Veja mais detalhes na [Documentação do JetBrains AI Assistant](https://www.jetbrains.com/help/ai-assistant/configure-an-mcp-server.html).
1. Nos IDEs da JetBrains vá em `Settings` -> `Tools` -> `AI Assistant` -> `Model Context Protocol (MCP)`
2. Clique em `+ Add`.
3. Clique em `Command` no canto superior esquerdo do diálogo e selecione a opção As JSON na lista
4. Adicione esta configuração e clique em `OK`
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
5. Clique em `Apply` para salvar as alterações.
6. Da mesma forma, o context7 pode ser adicionado ao JetBrains Junie em `Settings` -> `Tools` -> `Junie` -> `MCP Settings`
</details>
<details>
<summary><b>Instalar no Kiro</b></summary>
Veja a [Documentação do Kiro Model Context Protocol](https://kiro.dev/docs/mcp/configuration/) para detalhes.
1. Navegue até `Kiro` > `MCP Servers`
2. Adicione um novo servidor MCP clicando no botão `+ Add`.
3. Cole a configuração abaixo:
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
4. Clique em `Save` para aplicar as alterações.
</details>
<details>
<summary><b>Instalar no Trae</b></summary>
Use o recurso Add manually e preencha as informações de configuração JSON para esse servidor MCP.
Para mais detalhes, visite a [documentação do Trae](https://docs.trae.ai/ide/model-context-protocol?_lang=en).
#### Conexão Remota do Servidor Trae
```json
{
  "mcpServers": {
    "context7": {
      "url": "https://mcp.context7.com/mcp"
    }
  }
}
```
#### Conexão Local do Servidor Trae
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
<summary><b>Usando Bun ou Deno</b></summary>
Use estas alternativas para executar o servidor Context7 MCP local com outros runtimes. Esses exemplos funcionam para qualquer cliente que suporte iniciar um servidor MCP local via command + args.
#### Bun
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
#### Deno
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
<details>
<summary><b>Usando Docker</b></summary>
Se preferir executar o servidor MCP em um contêiner Docker:
1. **Crie a Imagem Docker:**
   Primeiro, crie um `Dockerfile` na raiz do projeto (ou onde preferir):
   <details>
   <summary>Clique para ver o conteúdo do Dockerfile</summary>
   ```Dockerfile
   FROM node:18-alpine
   WORKDIR /app
   # Instalar a versão mais recente globalmente
   RUN npm install -g @upstash/context7-mcp
   # Expor porta padrão se necessário (opcional, depende da interação do cliente MCP)
   # EXPOSE 3000
   # Comando padrão para rodar o servidor
   CMD ["context7-mcp"]
   ```
   </details>
   Em seguida, construa a imagem usando uma tag (por exemplo, `context7-mcp`). **Certifique-se de que o Docker Desktop (ou o daemon Docker) esteja em execução.** Execute o comando abaixo no mesmo diretório onde você salvou o `Dockerfile`:
   ```bash
   docker build -t context7-mcp .
   ```
2. **Configure seu Cliente MCP:**
   Atualize a configuração do seu cliente MCP para usar o comando Docker.
   _Exemplo para um cline_mcp_settings.json:_
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
   _Nota: Este é um exemplo de configuração. Consulte os exemplos específicos do seu cliente MCP (como Cursor, VS Code, etc.) anteriormente neste README para adaptar a estrutura (por exemplo, `mcpServers` vs `servers`). Além disso, garanta que o nome da imagem em `args` corresponda à tag usada durante o comando `docker build`._
</details>
<details>
<summary><b>Instalar Usando a Extensão Desktop</b></summary>
Instale o arquivo [context7.dxt](dxt/context7.dxt) na pasta dxt e adicione-o ao seu cliente. Para mais informações, confira a [documentação de desktop extensions](https://github.com/anthropics/dxt#desktop-extensions-dxt).
</details>
<details>
<summary><b>Instalar no Windows</b></summary>
A configuração no Windows é um pouco diferente em comparação ao Linux ou macOS (_`Cline` é usado no exemplo_). O mesmo princípio se aplica a outros editores; consulte a configuração de `command` e `args`.
```json
{
  "mcpServers": {
    "github.com/upstash/context7-mcp": {
      "command": "cmd",
      "args": ["/c", "npx", "-y", "@upstash/context7-mcp"],
      "disabled": false,
      "autoApprove": []
    }
  }
}
```
</details>
<details>
<summary><b>Instalar no Amazon Q Developer CLI</b></summary>
Adicione isto ao arquivo de configuração do Amazon Q Developer CLI. Veja mais em [documentação do Amazon Q Developer CLI](https://docs.aws.amazon.com/amazonq/latest/qdeveloper-ug/command-line-mcp-configuration.html).
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
<summary><b>Instalar no Warp</b></summary>
Veja mais em [Documentação do Warp Model Context Protocol](https://docs.warp.dev/knowledge-and-collaboration/mcp#adding-an-mcp-server).
1. Vá em `Settings` > `AI` > `Manage MCP servers`.
2. Adicione um novo servidor MCP clicando no botão `+ Add`.
3. Cole a configuração abaixo:
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
4. Clique em `Save` para aplicar as alterações.
</details>
<details>
<summary><b>Instalar no Copilot Coding Agent</b></summary>
## Usando o Context7 com o Copilot Coding Agent
Adicione a seguinte configuração à seção `mcp` do arquivo de configuração do seu Copilot Coding Agent Repository->Settings->Copilot->Coding agent->MCP configuration:
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
Para mais informações, veja a [documentação oficial do GitHub](https://docs.github.com/en/enterprise-cloud@latest/copilot/how-tos/agents/copilot-coding-agent/extending-copilot-coding-agent-with-mcp).
</details>
<details>
<summary><b>Instalar no Copilot CLI</b></summary>
1.  Abra o arquivo de configuração MCP do Copilot CLI. A localização é `~/.copilot/mcp-config.json` (onde `~` é o seu diretório home).
2.  Adicione o seguinte ao objeto `mcpServers` no seu arquivo `mcp-config.json`:
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
Ou, para um servidor local:
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
Se o arquivo `mcp-config.json` não existir, crie-o.
</details>
<details>
<summary><b>Instalar no LM Studio</b></summary>
Veja mais em [Suporte a MCP no LM Studio](https://lmstudio.ai/blog/lmstudio-v0.3.17).
#### Instalação com um clique:
[![Add MCP Server context7 to LM Studio](https://files.lmstudio.ai/deeplink/mcp-install-light.svg)](https://lmstudio.ai/install-mcp?name=context7&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkB1cHN0YXNoL2NvbnRleHQ3LW1jcCJdfQ%3D%3D)
#### Configuração manual:
1. Navegue até `Program` (lado direito) > `Install` > `Edit mcp.json`.
2. Cole a configuração abaixo:
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
3. Clique em `Save` para aplicar as alterações.
4. Ative/desative o servidor MCP no lado direito, em `Program`, ou clicando no ícone de plug na parte inferior da caixa de chat.
</details>
<details>
<summary><b>Instalar no Visual Studio 2022</b></summary>
Você pode configurar o Context7 MCP no Visual Studio 2022 seguindo a [documentação de MCP Servers do Visual Studio](https://learn.microsoft.com/visualstudio/ide/mcp-servers?view=vs-2022).
Adicione isto ao arquivo de configuração MCP do Visual Studio (veja os [docs do Visual Studio](https://learn.microsoft.com/visualstudio/ide/mcp-servers?view=vs-2022) para detalhes):
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
Ou, para um servidor local:
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
Para mais informações e solução de problemas, consulte a [documentação de MCP Servers do Visual Studio](https://learn.microsoft.com/visualstudio/ide/mcp-servers?view=vs-2022).
</details>
<details>
<summary><b>Instalar no Crush</b></summary>
Adicione isto ao arquivo de configuração do Crush. Veja mais em [Crush MCP docs](https://github.com/charmbracelet/crush#mcps).
#### Conexão Remota do Crush
```json
{
  "$schema": "https://charm.land/crush.json",
  "mcp": {
    "context7": {
      "type": "http",
      "url": "https://mcp.context7.com/mcp"
    }
  }
}
```
#### Conexão Local do Crush
```json
{
  "$schema": "https://charm.land/crush.json",
  "mcp": {
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
<summary><b>Instalar no BoltAI</b></summary>
Abra a página "Settings" do app, navegue até "Plugins" e insira o seguinte JSON:
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
Depois de salvar, digite no chat `query-docs` seguido do seu Context7 documentation ID (por exemplo, `query-docs /nuxt/ui`). Mais informações em [BoltAI's Documentation site](https://docs.boltai.com/docs/plugins/mcp-servers). Para o BoltAI no iOS, [veja este guia](https://docs.boltai.com/docs/boltai-mobile/mcp-servers).
</details>
<details>
<summary><b>Instalar no Rovo Dev CLI</b></summary>
Edite sua configuração MCP do Rovo Dev CLI executando o comando abaixo -
```bash
acli rovodev mcp
```
Configuração de exemplo -
#### Conexão Remota
```json
{
  "mcpServers": {
    "context7": {
      "url": "https://mcp.context7.com/mcp"
    }
  }
}
```
#### Conexão Local
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
<summary><b>Instalar no Zencoder</b></summary>
Para configurar o Context7 MCP no Zencoder, siga estes passos:
1. Vá ao menu do Zencoder (...)
2. No menu suspenso, selecione Agent tools
3. Clique em Add custom MCP
4. Adicione o nome e a configuração do servidor abaixo e certifique-se de clicar no botão Install
```json
{
  "command": "npx",
  "args": ["-y", "@upstash/context7-mcp"]
}
```
Depois que o servidor MCP for adicionado, você pode continuar usando-o facilmente.
</details>
<details>
<summary><b>Instalar no Qodo Gen</b></summary>
Veja mais em [docs do Qodo Gen](https://docs.qodo.ai/qodo-documentation/qodo-gen/qodo-gen-chat/agentic-mode/agentic-tools-mcps).
1. Abra o painel de chat do Qodo Gen no VSCode ou IntelliJ.
2. Clique em Connect more tools.
3. Clique em + Add new MCP.
4. Adicione a seguinte configuração:
#### Conexão Local do Qodo Gen
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
#### Conexão Remota do Qodo Gen
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
<summary><b>Instalar no Perplexity Desktop</b></summary>
Veja mais em [Local and Remote MCPs for Perplexity](https://www.perplexity.ai/help-center/en/articles/11502712-local-and-remote-mcps-for-perplexity).
1. Vá em `Perplexity` > `Settings`
2. Selecione `Connectors`.
3. Clique em `Add Connector`.
4. Selecione `Advanced`.
5. Insira Server Name: `Context7`
6. Cole o seguinte JSON na área de texto:
```json
{
  "args": ["-y", "@upstash/context7-mcp"],
  "command": "npx",
  "env": {}
}
```
7. Clique em `Save`.
</details>
## 🔨 Ferramentas Disponíveis
O Context7 MCP fornece as seguintes ferramentas que LLMs podem usar:
- `resolve-library-id`: Resolve um nome geral de biblioteca em um ID compatível com o Context7.
  - `query` (obrigatório): A pergunta ou tarefa do usuário (para ranking de relevância)
  - `libraryName` (obrigatório): O nome da biblioteca a ser pesquisada
- `query-docs`: Busca documentação para uma biblioteca usando um ID compatível com o Context7.
  - `libraryId` (obrigatório): ID exato compatível com Context7 (por exemplo, `/mongodb/docs`, `/vercel/next.js`)
  - `query` (obrigatório): A pergunta ou tarefa para obter documentação relevante
## 🛟 Dicas
### Adicionar uma Regra
> Se você não quiser adicionar `use context7` a todo prompt, você pode definir uma regra simples no seu arquivo `.windsurfrules` no Windsurf ou em `Cursor Settings > Rules` no Cursor (ou equivalente no seu cliente MCP) para invocar o Context7 automaticamente em qualquer questão de código:
>
> ```toml
> [[calls]]
> match = "quando o usuário solicitar exemplos de código, passos de configuração ou documentação de biblioteca/API"
> tool  = "context7"
> ```
>
> A partir daí você receberá os docs do Context7 em qualquer conversa relacionada sem digitar nada extra. Você pode adicionar seus casos de uso na parte match.
### Usar o ID da Biblioteca
> Se você já sabe exatamente qual biblioteca deseja usar, adicione o ID do Context7 ao seu prompt. Assim, o servidor MCP do Context7 pode pular a etapa de correspondência de biblioteca e ir direto para recuperar os docs.
>
> ```txt
> implementar autenticação básica com supabase. use library /supabase/supabase para api e docs
> ```
>
> A sintaxe com barra informa à ferramenta MCP exatamente qual biblioteca carregar.
## 💻 Desenvolvimento
Clone o projeto e instale as dependências:
```bash
pnpm i
```
Build:
```bash
pnpm run build
```
Execute o servidor:
```bash
node packages/mcp/dist/index.js
```
### Argumentos de CLI
`context7-mcp` aceita as seguintes flags de CLI:
- `--transport <stdio|http>` – Transporte a ser usado (`stdio` por padrão). Use `http` para servidor HTTP remoto ou `stdio` para integração local.
- `--port <number>` – Porta para escutar ao usar o transporte `http` (padrão `3000`).
Exemplo com transporte http e porta 8080:
```bash
node packages/mcp/dist/index.js --transport http --port 8080
```
Outro exemplo com transporte stdio:
```bash
node packages/mcp/dist/index.js --transport stdio
```
<details>
<summary><b>Exemplo de Configuração Local</b></summary>
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
<summary><b>Testando com o MCP Inspector</b></summary>
```bash
npx -y @modelcontextprotocol/inspector npx @upstash/context7-mcp
```
</details>
## 🚨 Solução de Problemas
<details>
<summary><b>Erros de Módulo Não Encontrado</b></summary>
Se você encontrar `ERR_MODULE_NOT_FOUND`, tente usar `bunx` em vez de `npx`:
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
Isso frequentemente resolve problemas de resolução de módulos em ambientes onde o `npx` não instala ou resolve os pacotes corretamente.
</details>
<details>
<summary><b>Problemas de Resolução ESM</b></summary>
Para erros como `Error: Cannot find module 'uriTemplate.js'`, tente a flag `--experimental-vm-modules`:
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
<summary><b>Problemas de TLS/Certificados</b></summary>
Use a flag `--experimental-fetch` para contornar problemas relacionados a TLS:
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
<summary><b>Erros Gerais do Cliente MCP</b></summary>
1. Tente adicionar `@latest` ao nome do pacote
2. Use `bunx` como alternativa ao `npx`
3. Considere usar `deno` como outra alternativa
4. Certifique-se de estar usando Node.js v18 ou superior para suporte nativo a fetch
</details>
## ⚠️ Aviso
Os projetos do Context7 são contribuídos pela comunidade e, embora nos esforcemos para manter alta qualidade, não podemos garantir a precisão, integridade ou segurança de toda a documentação de bibliotecas. Os projetos listados no Context7 são desenvolvidos e mantidos por seus respectivos proprietários, não pelo Context7. Se você encontrar qualquer conteúdo suspeito, impróprio ou potencialmente prejudicial, use o botão "Report" na página do projeto para nos notificar imediatamente. Levamos todos os relatos a sério e revisaremos o conteúdo sinalizado prontamente para manter a integridade e a segurança de nossa plataforma. Ao usar o Context7, você reconhece que o faz por sua própria conta e risco.
## 🤝 Conecte-se Conosco
Mantenha-se atualizado e junte-se à nossa comunidade:
- 📢 Siga-nos no [X](https://x.com/context7ai) para as últimas notícias e atualizações
- 🌐 Visite nosso [Website](https://context7.com)
- 💬 Junte-se ao nosso [Discord Community](https://upstash.com/discord)
## 📺 Context7 na Mídia
- [Better Stack: "Free Tool Makes Cursor 10x Smarter"](https://youtu.be/52FC3qObp9E)
- [Cole Medin: "This is Hands Down the BEST MCP Server for AI Coding Assistants"](https://www.youtube.com/watch?v=G7gK8H6u7Rs)
- [Income Stream Surfers: "Context7 + SequentialThinking MCPs: Is This AGI?"](https://www.youtube.com/watch?v=-ggvzyLpK6o)
- [Julian Goldie SEO: "Context7: New MCP AI Agent Update"](https://www.youtube.com/watch?v=CTZm6fBYisc)
- [JeredBlu: "Context 7 MCP: Get Documentation Instantly + VS Code Setup"](https://www.youtube.com/watch?v=-ls0D-rtET4)
- [Income Stream Surfers: "Context7: The New MCP Server That Will CHANGE AI Coding"](https://www.youtube.com/watch?v=PS-2Azb-C3M)
- [AICodeKing: "Context7 + Cline & RooCode: This MCP Server Makes CLINE 100X MORE EFFECTIVE!"](https://www.youtube.com/watch?v=qZfENAPMnyo)
- [Sean Kochel: "5 MCP Servers For Vibe Coding Glory (Just Plug-In & Go)"](https://www.youtube.com/watch?v=LqTQi8qexJM)
## ⭐ Histórico de Stars
[![Gráfico de Histórico de Stars](https://api.star-history.com/svg?repos=upstash/context7&type=Date)](https://www.star-history.com/#upstash/context7&Date)
## 📄 Licença
MIT
