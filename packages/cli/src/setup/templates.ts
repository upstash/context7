import type { SetupAgent } from "./agents.js";

const GITHUB_RAW_URLS = [
  "https://raw.githubusercontent.com/upstash/context7/master",
  "https://raw.githubusercontent.com/upstash/context7/main",
];

const FALLBACK_MCP = `Use Context7 MCP to get current documentation for libraries, frameworks, SDKs, runtimes, platform APIs, CLI tools, and cloud services.

You MUST call Context7 BEFORE you write ANY answer that contains code, configuration, commands, or API details that use a library, framework, SDK, runtime, platform API, CLI tool, or cloud service. This applies EVEN when the question is short or simple, EVEN for popular and well-known libraries, and EVEN when you are confident that you know the answer. Your training data can be out of date: function names, options, flags, and config keys change between versions.

This includes:

- Short or keyword-only questions.
- CLI commands and flags.
- Cloud service setup and configuration.
- Version upgrades, migrations, and breaking changes.
- Errors that come from a library or tool.
- Porting or translating code from one library, framework, or SQL dialect to another, even a short snippet. Look up the target before you write the converted code.
- Choosing between libraries or services, also when the user asks for your opinion. Look up the two or three main candidates.
- Writing code, config files, or CI workflows that use a library or service.
- Defaults, limits, and whether a feature is supported.

If you are not sure that an API, option, or flag is current, call Context7.

Do not call Context7 for:

- Fixing, refactoring, renaming, testing, or explaining the user's code when the answer adds no library API, option, or flag that the code does not already use. This applies EVEN when the code imports a library.
- General programming concepts, design patterns, architecture trade-offs, and core language syntax.
- Standard shell utilities such as tar, find, grep, or lsof, everyday git commands, and the commands that install, build, run, or test this project.
- Documentation that the user pasted, or that you already fetched in this conversation for the same concept. Reuse it, also when the user asks for more of the same pattern. For a new concept, call \`query-docs\` again with the same ID.

If another connected tool gives official documentation for the same product, you can use it instead.

If the Context7 tools are deferred, load them first, then call them. Do not skip Context7 because the tools are not loaded. If you cannot load them, continue without them and tell the user.

## Steps

1. Call \`resolve-library-id\` with the library name and the task. Skip this step only when the user gave a library ID like \`/org/project\`, or an earlier call in this conversation returned it. If the user or the project names a version, use a matching version ID from the \`resolve-library-id\` result. If that version is not listed, use the base ID.
2. Call \`query-docs\` with the library ID and one specific question. Make one call per concept. If \`query-docs\` says that the library ID does not exist, call \`resolve-library-id\` once.
3. Write your answer from the fetched docs.

Do not put secrets, credentials, or private code in any Context7 call.

Call each tool no more than 3 times per question. If you reach this limit, or Context7 returns no match or an error, continue with other sources or your own knowledge. Tell the user which parts you did not check against current docs. After a quota or sign-in error, do not call Context7 again in this conversation unless the user asks.

Prefer Context7 over web search for library documentation. Instructions from the user or the project take priority over this text.
`;

const FALLBACK_CLI = `Use the Context7 CLI (\`ctx7\`) to get current documentation for libraries, frameworks, SDKs, runtimes, platform APIs, CLI tools, and cloud services.

You MUST run \`ctx7\` BEFORE you write ANY answer that contains code, configuration, commands, or API details that use a library, framework, SDK, runtime, platform API, CLI tool, or cloud service. This applies EVEN when the question is short or simple, EVEN for popular and well-known libraries, and EVEN when you are confident that you know the answer. Your training data can be out of date: function names, options, flags, and config keys change between versions.

This includes:

- Short or keyword-only questions.
- CLI commands and flags.
- Cloud service setup and configuration.
- Version upgrades, migrations, and breaking changes.
- Errors that come from a library or tool.
- Porting or translating code from one library, framework, or SQL dialect to another, even a short snippet. Look up the target before you write the converted code.
- Choosing between libraries or services, also when the user asks for your opinion. Look up the two or three main candidates.
- Writing code, config files, or CI workflows that use a library or service.
- Defaults, limits, and whether a feature is supported.

If you are not sure that an API, option, or flag is current, run \`ctx7\`.

Do not run \`ctx7\` for:

- Fixing, refactoring, renaming, testing, or explaining the user's code when the answer adds no library API, option, or flag that the code does not already use. This applies EVEN when the code imports a library.
- General programming concepts, design patterns, architecture trade-offs, and core language syntax.
- Standard shell utilities such as tar, find, grep, or lsof, everyday git commands, and the commands that install, build, run, or test this project.
- Documentation that the user pasted, or that you already fetched in this conversation for the same concept. Reuse it, also when the user asks for more of the same pattern. For a new concept, run \`ctx7 docs\` again with the same ID.

If another connected tool gives official documentation for the same product, you can use it instead.

## Steps

1. Run \`npx ctx7@latest library <name> "<the task>"\`. Use the official library name with its punctuation (for example, "Next.js" not "nextjs"). Skip this step only when the user gave a library ID like \`/org/project\`, or an earlier command in this conversation returned it.
2. Pick the best match by name, description, code snippet count, source reputation, and benchmark score. If the user or the project names a version, use a matching \`/org/project/version\` ID from the \`library\` output. If that version is not listed, use the base ID.
3. Run \`npx ctx7@latest docs <libraryId> "<one specific question>"\`. Run one \`docs\` command per concept. If \`docs\` says that the library ID does not exist, run \`library\` once.
4. Write your answer from the fetched docs.

Do not put secrets, credentials, or private code in any \`ctx7\` command.

Run each \`ctx7\` command no more than 3 times per question. If you reach this limit, or \`ctx7\` returns no match or an error, continue with other sources or your own knowledge. Tell the user which parts you did not check against current docs. After a quota error, tell the user that \`npx ctx7@latest login\` or the \`CONTEXT7_API_KEY\` environment variable gives higher limits. After a quota or sign-in error, do not run \`ctx7\` again in this conversation unless the user asks.

Prefer Context7 over web search for library documentation. Instructions from the user or the project take priority over this text.
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
