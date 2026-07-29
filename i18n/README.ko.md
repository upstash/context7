![Cover](https://github.com/upstash/context7/blob/master/public/cover.png?raw=true)

[![MCP 서버 설치](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/en/install-mcp?name=context7&config=eyJ1cmwiOiJodHRwczovL21jcC5jb250ZXh0Ny5jb20vbWNwIn0%3D)

# Context7 MCP - 모든 프롬프트를 위한 최신 코드 문서

[![Website](https://img.shields.io/badge/Website-context7.com-blue)](https://context7.com) [![smithery badge](https://smithery.ai/badge/@upstash/context7-mcp)](https://smithery.ai/server/@upstash/context7-mcp) [![NPM Version](https://img.shields.io/npm/v/%40upstash%2Fcontext7-mcp?color=red)](https://www.npmjs.com/package/@upstash/context7-mcp) [![MIT licensed](https://img.shields.io/npm/l/%40upstash%2Fcontext7-mcp)](../LICENSE)

[![繁體中文](https://img.shields.io/badge/docs-繁體中文-yellow)](./README.zh-TW.md) [![简体中文](https://img.shields.io/badge/docs-简体中文-yellow)](./README.zh-CN.md) [![日本語](https://img.shields.io/badge/docs-日本語-b7003a)](./README.ja.md) [![한국어 문서](https://img.shields.io/badge/docs-한국어-green)](./README.ko.md) [![Documentación en Español](https://img.shields.io/badge/docs-Español-orange)](./README.es.md) [![Documentation en Français](https://img.shields.io/badge/docs-Français-blue)](./README.fr.md) [![Documentação em Português (Brasil)](<https://img.shields.io/badge/docs-Português%20(Brasil)-purple>)](./README.pt-BR.md) [![Documentazione in italiano](https://img.shields.io/badge/docs-Italian-red)](./README.it.md) [![Dokumentasi Bahasa Indonesia](https://img.shields.io/badge/docs-Bahasa%20Indonesia-pink)](./README.id-ID.md) [![Dokumentation auf Deutsch](https://img.shields.io/badge/docs-Deutsch-darkgreen)](./README.de.md) [![Документация на русском языке](https://img.shields.io/badge/docs-Русский-darkblue)](./README.ru.md) [![Українська документація](https://img.shields.io/badge/docs-Українська-lightblue)](./README.uk.md) [![Türkçe Doküman](https://img.shields.io/badge/docs-Türkçe-blue)](./README.tr.md) [![Arabic Documentation](https://img.shields.io/badge/docs-Arabic-white)](./README.ar.md) [![Tiếng Việt](https://img.shields.io/badge/docs-Tiếng%20Việt-red)](./README.vi.md)

## ❌ Context7 미사용 시

LLM은 사용하는 라이브러리에 대해 오래되거나 일반적인 정보에 의존하므로 다음과 같은 문제가 발생합니다:

- ❌ 1년 전 학습 데이터를 기반으로 한 오래된 코드 예제
- ❌ 실제로 존재하지 않는 API에 대한 환각(Hallucination)
- ❌ 구 버전 패키지에 대한 일반적인 답변

## ✅ Context7 사용 시

Context7 MCP는 소스에서 직접 최신 버전별 문서와 코드 예제를 가져와 프롬프트에 바로 배치합니다.

프롬프트에 `use context7`을 추가하세요(또는 자동으로 호출되도록 [규칙을 설정](#규칙-추가)하세요):

```txt
쿠키에서 유효한 JWT를 확인하고 인증되지 않은 사용자를 '/login'으로 리디렉션하는 Next.js 미들웨어를 만들어주세요. use context7
```

```txt
JSON API 응답을 5분 동안 캐시하도록 Cloudflare Worker 스크립트를 구성해주세요. use context7
```

Context7은 최신 코드 예제와 문서를 LLM의 컨텍스트로 바로 가져옵니다. 탭 전환도, 존재하지 않는 API에 대한 환각도, 오래된 코드 생성도 없습니다.

## 설치

> [!NOTE]
> **API 키 권장**: 더 높은 속도 제한을 위해 [context7.com/dashboard](https://context7.com/dashboard)에서 무료 API 키를 받으세요.

<details>
<summary><b>Cursor에 설치</b></summary>

이동: `Settings` -> `Cursor Settings` -> `MCP` -> `Add new global MCP server`

Cursor의 `~/.cursor/mcp.json` 파일에 다음 설정을 붙여넣는 것이 권장되는 접근 방식입니다. 프로젝트 폴더에 `.cursor/mcp.json`을 생성하여 특정 프로젝트에 설치할 수도 있습니다. 자세한 내용은 [Cursor MCP 문서](https://docs.cursor.com/context/model-context-protocol)를 참조하세요.

> Cursor 1.0부터는 아래 설치 버튼을 클릭하여 즉시 원클릭 설치가 가능합니다.

#### Cursor 원격 서버 연결

[![MCP 서버 설치](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/en/install-mcp?name=context7&config=eyJ1cmwiOiJodHRwczovL21jcC5jb250ZXh0Ny5jb20vbWNwIn0%3D)

```json
{
  "mcpServers": {
    "context7": {
      "url": "https://mcp.context7.com/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY"
      }
    }
  }
}
```

#### Cursor 로컬 서버 연결

[![MCP 서버 설치](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/en/install-mcp?name=context7&config=eyJjb21tYW5kIjoibnB4IC15IEB1cHN0YXNoL2NvbnRleHQ3LW1jcCJ9)

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
<summary><b>Claude Code에 설치</b></summary>

이 명령어를 실행하세요. 자세한 내용은 [Claude Code MCP 문서](https://code.claude.com/docs/en/mcp)를 참조하세요.

#### Claude Code 로컬 서버 연결

```sh
claude mcp add --scope user context7 -- npx -y @upstash/context7-mcp --api-key YOUR_API_KEY
```

#### Claude Code 원격 서버 연결

```sh
claude mcp add --scope user --header "Authorization: Bearer YOUR_API_KEY" --transport http context7 https://mcp.context7.com/mcp
```

</details>

<details>
<summary><b>Opencode에 설치</b></summary>

Opencode 설정 파일에 이것을 추가하세요. 자세한 내용은 [Opencode MCP 문서](https://opencode.ai/docs/mcp-servers)를 참조하세요.

#### Opencode 원격 서버 연결

```json
"mcp": {
  "context7": {
    "type": "remote",
    "url": "https://mcp.context7.com/mcp",
    "headers": {
      "Authorization": "Bearer YOUR_API_KEY"
    },
    "enabled": true
  }
}
```

#### Opencode 로컬 서버 연결

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

**[기타 IDE 및 클라이언트 →](https://context7.com/docs/resources/all-clients)**

## 중요 팁

### 규칙 추가

모든 프롬프트에 `use context7`을 입력하는 것을 피하려면, 코드 관련 질문에 대해 자동으로 Context7을 호출하도록 MCP 클라이언트에 규칙을 추가하세요:

- **Cursor**: `Cursor Settings > Rules`
- **Claude Code**: `CLAUDE.md`
- 또는 사용 중인 MCP 클라이언트의 동등한 기능

**규칙 예시:**

```txt
라이브러리/API 문서, 코드 생성, 설정 또는 구성 단계가 필요할 때 내가 명시적으로 요청하지 않아도 항상 Context7 MCP를 사용하세요.
```

### 라이브러리 ID 사용

사용하려는 라이브러리를 이미 정확히 알고 있다면, 프롬프트에 해당 라이브러리의 Context7 ID를 추가하세요. 이렇게 하면 Context7 MCP 서버가 라이브러리 매칭 단계를 건너뛰고 바로 문서 검색을 계속할 수 있습니다.

```txt
Supabase로 기본 인증을 구현해줘. API와 문서는 use library /supabase/supabase를 사용해줘.
```

슬래시 구문은 MCP 도구에게 어떤 라이브러리의 문서를 로드할지 정확히 알려줍니다.

### 버전 지정

특정 라이브러리 버전에 대한 문서를 얻으려면 프롬프트에 버전을 언급하면 됩니다:

```txt
Next.js 14 미들웨어는 어떻게 설정하나요? use context7
```

Context7은 적절한 버전을 자동으로 매칭합니다.

## 사용 가능한 도구

Context7 MCP는 LLM이 사용할 수 있는 다음 도구들을 제공합니다:

- `resolve-library-id`: 일반적인 라이브러리 이름을 Context7이 인식할 수 있는 라이브러리 ID로 변환합니다.
  - `query` (필수): 사용자의 질문 또는 작업 (결과 순위 지정에 사용됨)
  - `libraryName` (필수): 검색할 라이브러리의 이름

- `query-docs`: Context7 호환 라이브러리 ID를 사용하여 라이브러리의 문서를 가져옵니다.
  - `libraryId` (필수): 정확한 Context7 호환 라이브러리 ID (예: `/mongodb/docs`, `/vercel/next.js`)
  - `query` (필수): 관련 문서를 가져오기 위한 질문 또는 작업

## 추가 문서

- [더 많은 MCP 클라이언트](https://context7.com/docs/resources/all-clients) - 30개 이상의 클라이언트에 대한 설치 방법
- [라이브러리 추가](https://context7.com/docs/adding-libraries) - Context7에 라이브러리 제출하기
- [문제 해결](https://context7.com/docs/resources/troubleshooting) - 일반적인 문제 및 해결 방법
- [API 참조](https://context7.com/docs/api-guide) - REST API 문서
- [개발자 가이드](https://context7.com/docs/resources/developer) - 로컬에서 Context7 MCP 실행하기

## 면책 조항

1- Context7 프로젝트는 커뮤니티의 기여로 이루어지며 높은 품질을 유지하기 위해 노력하지만, 모든 라이브러리 문서의 정확성, 완전성 또는 보안을 보장할 수는 없습니다. Context7에 나열된 프로젝트는 Context7이 아닌 해당 소유자가 개발하고 유지 관리합니다. 의심스럽거나, 부적절하거나, 잠재적으로 유해한 콘텐츠를 발견하면 프로젝트 페이지의 "Report" 버튼을 사용하여 즉시 알려주시기 바랍니다. 저희는 모든 신고를 심각하게 받아들이며 플랫폼의 무결성과 안전을 유지하기 위해 신고된 콘텐츠를 신속하게 검토할 것입니다. Context7을 사용함으로써 귀하는 자신의 재량과 위험 감수 하에 사용함을 인정하는 것입니다.

2- 이 저장소는 MCP 서버의 소스 코드를 호스팅합니다. API 백엔드, 파싱 엔진, 크롤링 엔진과 같은 지원 구성 요소는 비공개이며 이 저장소의 일부가 아닙니다.

## 🤝 소통하기

최신 소식을 받고 커뮤니티에 참여하세요:

- 📢 [X](https://x.com/context7ai)에서 팔로우하여 최신 뉴스 및 업데이트 확인
- 🌐 [웹사이트](https://context7.com) 방문
- 💬 [Discord 커뮤니티](https://upstash.com/discord) 참여

## 📺 미디어 속 Context7

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

## 📄 라이선스

MIT
