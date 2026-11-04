import type { SetupAgent } from "./agents.js";

const GITHUB_RAW_URLS = [
  "https://raw.githubusercontent.com/upstash/context7/master",
  "https://raw.githubusercontent.com/upstash/context7/main",
];

const FALLBACK_MCP = `IMPORTANT: Use Context7 MCP to get current documentation for third-party libraries, frameworks, SDKs, APIs, CLI tools, and cloud services.

You MUST call Context7 BEFORE you write ANY answer that contains code, configuration, or commands that use a third-party library, framework, SDK, API, CLI tool, or cloud service. This applies EVEN when the question is short or simple, EVEN for popular and well-known libraries, and EVEN when you are confident that you know the answer. Your training data can be OUT OF DATE: function names, options, flags, and config keys change between versions.

This ALWAYS includes:

- Short or keyword-only questions.
- CLI commands and flags.
- Cloud service setup and configuration.
- Version upgrades, migrations, and breaking changes.
- Errors that come from a library or tool.
- Porting code from one library, framework, or SQL dialect to another. Look up the TARGET.
- Choosing between libraries or services. Look up the candidates.
- Writing code, config files, or CI workflows that use a library or service.

If you are not sure whether a question needs current docs, call Context7.

Prefer Context7 over web search for library documentation.

If the Context7 tools are deferred or not loaded yet, load them FIRST, then call them. Do NOT skip Context7 because the tools are not loaded.

## Steps

1. Call \`resolve-library-id\` with the library name and what the user wants to do. Skip this step when the user gives a library ID like \`/org/project\`.
2. Pick the best match by name, description, code snippet count, source reputation, and benchmark score. When the user names a version, use the matching \`/org/project/version\` ID.
3. Call \`query-docs\` with the library ID and a specific question about one concept. Make one call per concept, and do not include secrets or private code.
4. Write your answer from the fetched docs. Do not call each tool more than 3 times per question.

Do NOT call Context7 when your answer only uses the user's own code, general programming concepts, or documentation that the user already pasted.
`;

const FALLBACK_CLI = `IMPORTANT: Use the Context7 CLI (\`ctx7\`) to get current documentation for third-party libraries, frameworks, SDKs, APIs, CLI tools, and cloud services.

You MUST run \`ctx7\` BEFORE you write ANY answer that contains code, configuration, or commands that use a third-party library, framework, SDK, API, CLI tool, or cloud service. This applies EVEN when the question is short or simple, EVEN for popular and well-known libraries, and EVEN when you are confident that you know the answer. Your training data can be OUT OF DATE: function names, options, flags, and config keys change between versions.

This ALWAYS includes:

- Short or keyword-only questions.
- CLI commands and flags.
- Cloud service setup and configuration.
- Version upgrades, migrations, and breaking changes.
- Errors that come from a library or tool.
- Porting code from one library, framework, or SQL dialect to another. Look up the TARGET.
- Choosing between libraries or services. Look up the candidates.
- Writing code, config files, or CI workflows that use a library or service.

If you are not sure whether a question needs current docs, run \`ctx7\`.

Prefer Context7 over web search for library documentation.

## Steps

1. Run \`npx ctx7@latest library <name> "<what the user wants to do>"\`. Use the official library name with its punctuation (for example, "Next.js" not "nextjs"). Skip this step when the user gives a library ID like \`/org/project\`.
2. Pick the best match by name, description, code snippet count, source reputation, and benchmark score. If the results look wrong, try another name or rephrase the query. When the user names a version, use the matching \`/org/project/version\` ID from the \`library\` output.
3. Run \`npx ctx7@latest docs <libraryId> "<specific question about one concept>"\`. Run one \`docs\` command per concept, and do not include secrets or private code.
4. Write your answer from the fetched docs. Do not run more than 3 commands per question.

If a command fails with a quota error, tell the user and suggest \`npx ctx7@latest login\` or setting the \`CONTEXT7_API_KEY\` environment variable for higher limits. Do not silently fall back to training data.

Do NOT run \`ctx7\` when your answer only uses the user's own code, general programming concepts, or documentation that the user already pasted.
`;

const CODEX_CLI_SANDBOX_GUIDANCE = `Run Context7 CLI requests outside Codex's default sandbox. If a Context7 CLI command fails with DNS or network errors such as ENOTFOUND, host resolution failures, or fetch failed, rerun it outside the sandbox instead of retrying inside the sandbox.`;

export type RuleMode = "mcp" | "cli";

function customizeRuleContent(mode: RuleMode, agent: SetupAgent, body: string): string {
  if (mode === "cli" && agent === "codex" && !body.includes(CODEX_CLI_SANDBOX_GUIDANCE)) {
    body = `${body.trimEnd()}\n${CODEX_CLI_SANDBOX_GUIDANCE}\n`;
  }

  return body;
}

async function fetchRepoFile(path: string): Promise<string | null> {
  for (const base of GITHUB_RAW_URLS) {
    try {
      const res = await fetch(`${base}/${path}`);
      if (res.ok) return await res.text();
    } catch {
      continue;
    }
  }
  return null;
}

export async function getRuleContent(mode: RuleMode, agent: SetupAgent): Promise<string> {
  const [filename, fallback] =
    mode === "mcp" ? ["context7-mcp.md", FALLBACK_MCP] : ["context7-cli.md", FALLBACK_CLI];
  const body = (await fetchRepoFile(`rules/${filename}`)) ?? fallback;
  return customizeRuleContent(mode, agent, body);
}

// Setup skills are single SKILL.md files in this repo's `skills/` directory.
export async function fetchSetupSkillFiles(
  name: "find-docs" | "context7-mcp"
): Promise<Array<{ path: string; content: string }> | null> {
  const content = await fetchRepoFile(`skills/${name}/SKILL.md`);
  return content ? [{ path: "SKILL.md", content }] : null;
}

export function getBundledRuleContent(mode: RuleMode, agent: SetupAgent): string {
  return customizeRuleContent(mode, agent, mode === "mcp" ? FALLBACK_MCP : FALLBACK_CLI);
}

export function getBundledMcpSkillFiles(): Array<{ path: string; content: string }> {
  return [
    {
      path: "SKILL.md",
      content: `---\nname: context7-mcp\ndescription: Fetch current library documentation with Context7 MCP tools.\n---\n\n# Context7 MCP\n\n${FALLBACK_MCP}`,
    },
  ];
}

export function getBundledFindDocsSkillFiles(): Array<{ path: string; content: string }> {
  return [
    {
      path: "SKILL.md",
      content: `---\nname: find-docs\ndescription: Fetch current library documentation with the ctx7 CLI.\n---\n\n# Find Docs\n\n${FALLBACK_CLI}`,
    },
  ];
}

export function customizeSkillFilesForAgent(
  agent: SetupAgent,
  skillName: string,
  files: Array<{ path: string; content: string }>
): Array<{ path: string; content: string }> {
  if (agent !== "codex" || skillName !== "find-docs") {
    return files;
  }

  return files.map((file) => {
    if (file.path !== "SKILL.md" || file.content.includes(CODEX_CLI_SANDBOX_GUIDANCE)) {
      return file;
    }

    const marker = "## Step 1: Resolve a Library";
    const guidance = `${CODEX_CLI_SANDBOX_GUIDANCE}\n\n`;

    if (file.content.includes(marker)) {
      return {
        ...file,
        content: file.content.replace(marker, `${guidance}${marker}`),
      };
    }

    const separator = file.content.endsWith("\n") ? "\n" : "\n\n";
    return {
      ...file,
      content: `${file.content}${separator}${CODEX_CLI_SANDBOX_GUIDANCE}\n`,
    };
  });
}
