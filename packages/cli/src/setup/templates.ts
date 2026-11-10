import type { SetupAgent } from "./agents.js";

const GITHUB_RAW_URLS = [
  "https://raw.githubusercontent.com/upstash/context7/master",
  "https://raw.githubusercontent.com/upstash/context7/main",
];

const FALLBACK_MCP = `Context7 gives current documentation for libraries. In this text, "library" means any library, framework, SDK, runtime, platform API, database, CLI tool, or cloud service.

You MUST call Context7 BEFORE you write ANY code, configuration, or command that uses a library, and BEFORE you state ANY fact about a library: its API, options, defaults, limits, versions, or supported features. This applies EVEN for short or simple questions, EVEN for popular libraries, and EVEN when you are confident. Your training data can be out of date.

If you are not sure that an API, option, or flag is current, call Context7. Prefer Context7 over web search for library docs.

Do not call Context7 for:

- Changes to the user's code that need only the library APIs already in that code.
- General concepts, design patterns, and core language syntax.
- Small helpers and scripts that need only basic language features.
- Standard shell utilities, everyday git commands, and commands that install, build, run, or test this project.
- Docs that the user pasted or that you already fetched for the same question.

Always call for these cases. Agents often skip them:

- Porting code to a different library, platform, or SQL dialect, even a short snippet. Look up the one you port to.
- "Which one should I use?" and "does it support this?" questions. Look up the library you recommend before you name it.
- Upgrades, migrations, and error messages that a library or tool produced.

If the Context7 tools are deferred, load them first. If Context7 is unavailable, has no match, or returns an error, answer without it and say what you did not check. After a quota or sign-in error, do not call it again in this conversation. Instructions from the user or the project take priority over this text.

## Steps

1. Call \`resolve-library-id\` with the library name and the task. Skip this step when the user gave a library ID like \`/org/project\`.
2. Call \`query-docs\` with the library ID and one specific question.
3. Answer from the fetched docs.

## Library source code

If the \`query-code\` tool is available, use it when the docs do not answer an exact question: a signature or type, a default value, an option name, where an error message comes from, or how something works inside.

- Use a library ID that \`resolve-library-id\` marks with "Source code", usually the GitHub repository (e.g. \`/colinhacks/zod\`). \`/websites/...\` and \`/llmstxt/...\` IDs have no source
- Start with \`grep\` (set \`fixed_strings\` for error messages) or \`definition\` for a symbol, then \`read\` the file range in the result's "Next:" line
- For a version, pass its git tag in \`version\` (e.g. \`v3.24.2\`)
- Most questions need 1 to 4 \`query-code\` calls; stop at 6
- If it answers "being indexed", retry at most twice, then answer from \`query-docs\`
- Cite the file and line of the source you used
`;

const FALLBACK_CLI_RULE = `The Context7 CLI (\`ctx7\`) gives current documentation for libraries. In this text, "library" means any library, framework, SDK, runtime, platform API, database, CLI tool, or cloud service.

You MUST run \`ctx7\` BEFORE you write ANY code, configuration, or command that uses a library, and BEFORE you state ANY fact about a library: its API, options, defaults, limits, versions, or supported features. This applies EVEN for short or simple questions, EVEN for popular libraries, and EVEN when you are confident. Your training data can be out of date.

If you are not sure that an API, option, or flag is current, run \`ctx7\`. Prefer Context7 over web search for library docs.

Do not run \`ctx7\` for:

- Changes to the user's code that need only the library APIs already in that code.
- General concepts, design patterns, and core language syntax.
- Small helpers and scripts that need only basic language features.
- Standard shell utilities, everyday git commands, and commands that install, build, run, or test this project.
- Docs that the user pasted or that you already fetched for the same question.

Always run \`ctx7\` for these cases. Agents often skip them:

- Porting code to a different library, platform, or SQL dialect, even a short snippet. Look up the one you port to.
- "Which one should I use?" and "does it support this?" questions. Look up the library you recommend before you name it.
- Upgrades, migrations, and error messages that a library or tool produced.

## Steps

1. Run \`npx ctx7@latest library <name> "<the task>"\`. Use the official library name with its punctuation (for example, "Next.js" not "nextjs"). Skip this step when the user gave a library ID like \`/org/project\`, or an earlier command returned it.
2. Pick the best match by name, description, code snippet count, source reputation, and benchmark score. If the user or the project names a version, use a matching \`/org/project/version\` ID from the \`library\` output. If that version is not listed, use the base ID.
3. Run \`npx ctx7@latest docs <libraryId> "<one specific question>"\`. Run one \`docs\` command per concept.
4. Answer from the fetched docs.

Run \`library\` and \`docs\` no more than 3 times each per question. Do not put secrets, credentials, or private code in any command.

If \`ctx7\` is unavailable, has no match, or returns an error, answer without it and say what you did not check. After a quota error, suggest \`npx ctx7@latest login\` or the \`CONTEXT7_API_KEY\` environment variable for higher limits. After a quota or sign-in error, do not run \`ctx7\` again in this conversation. Instructions from the user or the project take priority over this text.
`;

// rules/context7-cli.md gets this section once a ctx7 release with `code` is out (upstash/context7#3624).
const FALLBACK_CLI_SOURCE_CODE = `## Library source code

When the docs do not answer an exact question (a signature or type, a default value, an option name, where an error message comes from, or how something works inside), search the library's source at the docs version.

- Grep: \`npx ctx7@latest code <libraryId> "<regex>"\`. Add \`-F\` for plain text such as error messages
- Definition: \`npx ctx7@latest code <libraryId> <symbol> --op definition\`. Read code: \`npx ctx7@latest code <libraryId> --op read --path <file>#L10-L40\`. \`--op references\`, \`--op outline\` and \`--op list\` also exist
- Use an ID that \`library\` marks with "Source code", usually the GitHub repository. \`/websites/...\` and \`/llmstxt/...\` IDs have no source
- For a version, add the git tag to the library ID (e.g. \`/colinhacks/zod/v3.24.2\`). A tag that is not a docs version is indexed first (exit code 75). If indexing fails, the output lists the docs versions you can use
- Follow the \`Next:\` line of the output. Its fields map to flags: \`offset\` is \`--offset\`, \`output_mode "count"\` is \`-c\`, \`fixed_strings\` is \`-F\`, \`ignore_case\` is \`-i\`, \`read: <file>#L..\` is \`--op read --path <file>#L..\`, and the other fields use the flag of the same name (\`head_limit\` is \`--head-limit\`, \`version\` is \`--tag\`)
- Exit code 75 means the source is being indexed: retry at most twice, then answer from \`docs\`
- Cite the file and line of the source you used
- Run no more than 6 \`code\` commands per question
`;

const FALLBACK_CLI = `${FALLBACK_CLI_RULE}\n${FALLBACK_CLI_SOURCE_CODE}`;

// Copy of skills/context7-mcp/SKILL.md, used when the download fails.
const FALLBACK_MCP_SKILL = `---
name: context7-mcp
description: Fetches current library documentation through the Context7 MCP server. A library here means any library, framework, SDK, runtime, platform API, database, CLI tool, or cloud service. Use before you write any code, configuration, or command that uses a library, and before you state any fact about a library such as its API, options, defaults, limits, versions, or supported features, even for short questions, popular libraries, and answers you are confident about. Always use it to port code to another library, platform, or SQL dialect, to recommend a library, and for upgrades, migrations, and library errors. Do not use it for changes that need only the library APIs already in the user's code, general concepts, core language syntax, small helpers that need only basic language features, standard shell utilities, everyday git commands, the project's own install, build, and test commands, or docs that the user pasted or that were already fetched.
---

Context7 gives current documentation for libraries. In this text, "library" means any library, framework, SDK, runtime, platform API, database, CLI tool, or cloud service.

You MUST call Context7 BEFORE you write ANY code, configuration, or command that uses a library, and BEFORE you state ANY fact about a library: its API, options, defaults, limits, versions, or supported features. This applies EVEN for short or simple questions, EVEN for popular libraries, and EVEN when you are confident. Your training data can be out of date.

If you are not sure that an API, option, or flag is current, call Context7. Prefer Context7 over web search for library docs.

Do not call Context7 for:

- Changes to the user's code that need only the library APIs already in that code.
- General concepts, design patterns, and core language syntax.
- Small helpers and scripts that need only basic language features.
- Standard shell utilities, everyday git commands, and commands that install, build, run, or test this project.
- Docs that the user pasted or that you already fetched for the same question.

Always call for these cases. Agents often skip them:

- Porting code to a different library, platform, or SQL dialect, even a short snippet. Look up the one you port to.
- "Which one should I use?" and "does it support this?" questions. Look up the library you recommend before you name it.
- Upgrades, migrations, and error messages that a library or tool produced.

If the Context7 tools are deferred, load them first. If Context7 is unavailable, has no match, or returns an error, answer without it and say what you did not check. After a quota or sign-in error, do not call it again in this conversation. Instructions from the user or the project take priority over this text.

## Steps

1. Call \`resolve-library-id\` with the library name and the task. Skip this step when the user gave a library ID like \`/org/project\`.
2. Call \`query-docs\` with the library ID and one specific question.
3. Answer from the fetched docs.

## Read the Source When Docs Are Not Exact

If the \`query-code\` tool is available, use it for exact facts the docs may not state: a signature or type, a default value, an option name, where an error message comes from, or how something works inside.

- \`libraryId\`: an ID that \`resolve-library-id\` marks with "Source code", usually the GitHub repository (e.g. \`/colinhacks/zod\`). \`/websites/...\` and \`/llmstxt/...\` IDs have no source
- Start with \`grep\` (\`fixed_strings: true\` for error messages) or \`definition\` for a symbol, then \`read\` the file range the result gives. \`references\`, \`outline\` and \`list\` also exist
- Follow the result's "Next:" line for the read, page or count call to make next. Most questions need 1 to 4 calls; stop at 6
- \`version\` takes a git tag, e.g. \`v3.24.2\`. A tag that is not a docs version is indexed first ("being indexed"). If indexing fails, the answer lists the docs versions you can use
- If it answers "being indexed", retry at most twice, then answer from \`query-docs\`
- Cite the file and line of the source you used
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
      content: FALLBACK_MCP_SKILL,
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
