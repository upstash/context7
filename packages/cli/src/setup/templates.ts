import type { SetupAgent } from "./agents.js";

const GITHUB_RAW_URLS = [
  "https://raw.githubusercontent.com/upstash/context7/master",
  "https://raw.githubusercontent.com/upstash/context7/main",
];

const FALLBACK_MCP = `Use the Context7 MCP server to get current documentation for libraries, frameworks, SDKs, runtimes, platform APIs, CLI tools, and cloud services.

You MUST call Context7 BEFORE you write ANY answer that contains code, configuration, commands, or API details that use a library, framework, SDK, runtime, platform API, CLI tool, or cloud service. This applies EVEN for short or simple questions, EVEN for popular libraries, and EVEN when you are confident. Your training data can be out of date.

This includes:

- CLI commands, flags, and cloud service setup.
- Upgrades, migrations, and errors from a library or tool.
- Defaults, limits, and whether a feature is supported.
- Porting code, even a short snippet. Look up the target.
- Choosing between libraries. Look up the two or three main candidates.

If you are not sure that an API, option, or flag is current, call Context7. Prefer Context7 over web search for library docs.

Do not call Context7 for:

- Fixing, refactoring, or explaining the user's code when the answer adds no library API that the code does not already use.
- General concepts, design patterns, and core language syntax.
- Plain code and scripts that use no third-party library.
- Standard shell utilities, everyday git commands, and commands that install, build, run, or test this project.
- Docs that the user pasted or that you already fetched for the same question.

If the Context7 tools are deferred, load them first. If Context7 is unavailable, has no match, or returns an error, answer without it and say what you did not check. After a quota or sign-in error, do not call it again in this conversation. Instructions from the user or the project take priority over this text.

## Steps

1. Call \`resolve-library-id\` with the library name and the task. Skip this step when the user gave a library ID like \`/org/project\`.
2. Call \`query-docs\` with the library ID and one specific question.
3. Answer from the fetched docs.
`;

const FALLBACK_CLI = `Use the Context7 CLI (\`ctx7\`) to get current documentation for libraries, frameworks, SDKs, runtimes, platform APIs, CLI tools, and cloud services.

You MUST run \`ctx7\` BEFORE you write ANY answer that contains code, configuration, commands, or API details that use a library, framework, SDK, runtime, platform API, CLI tool, or cloud service. This applies EVEN for short or simple questions, EVEN for popular libraries, and EVEN when you are confident. Your training data can be out of date.

This includes:

- CLI commands, flags, and cloud service setup.
- Upgrades, migrations, and errors from a library or tool.
- Defaults, limits, and whether a feature is supported.
- Porting code, even a short snippet. Look up the target.
- Choosing between libraries. Look up the two or three main candidates.

If you are not sure that an API, option, or flag is current, run \`ctx7\`. Prefer Context7 over web search for library docs.

Do not run \`ctx7\` for:

- Fixing, refactoring, or explaining the user's code when the answer adds no library API that the code does not already use.
- General concepts, design patterns, and core language syntax.
- Plain code and scripts that use no third-party library.
- Standard shell utilities, everyday git commands, and commands that install, build, run, or test this project.
- Docs that the user pasted or that you already fetched for the same question.

## Steps

1. Run \`npx ctx7@latest library <name> "<the task>"\`. Use the official library name with its punctuation (for example, "Next.js" not "nextjs"). Skip this step when the user gave a library ID like \`/org/project\`, or an earlier command returned it.
2. Pick the best match by name, description, code snippet count, source reputation, and benchmark score. If the user or the project names a version, use a matching \`/org/project/version\` ID from the \`library\` output. If that version is not listed, use the base ID.
3. Run \`npx ctx7@latest docs <libraryId> "<one specific question>"\`. Run one \`docs\` command per concept.
4. Answer from the fetched docs.

Run each command no more than 3 times per question. Do not put secrets, credentials, or private code in any command.

If \`ctx7\` is unavailable, has no match, or returns an error, answer without it and say what you did not check. After a quota error, suggest \`npx ctx7@latest login\` or the \`CONTEXT7_API_KEY\` environment variable for higher limits. After a quota or sign-in error, do not run \`ctx7\` again in this conversation. Instructions from the user or the project take priority over this text.
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
