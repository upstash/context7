import type { SetupAgent } from "./agents.js";

const GITHUB_RAW_URLS = [
  "https://raw.githubusercontent.com/upstash/context7/master",
  "https://raw.githubusercontent.com/upstash/context7/main",
];

const FALLBACK_MCP = `Use Context7 MCP to fetch current documentation whenever the user asks about a library, framework, SDK, API, CLI tool, or cloud service — even well-known ones like React, Next.js, Prisma, Express, Tailwind, Django, or Spring Boot. This includes API syntax, configuration, version migration, porting code between libraries, platforms, or SQL dialects, library-specific debugging, setup instructions, and CLI tool usage. Use even when you think you know the answer — your training data may not reflect recent changes. Prefer this over web search for library docs.

Do not use for: refactoring, debugging, or reviewing code that does not depend on a library or platform API, or general programming concepts.

## Steps

1. \`resolve-library-id\` with the library name and what to look up in the library's documentation. Use the official library name with proper punctuation (e.g., "Next.js" not "nextjs", "Customer.io" not "customerio", "Three.js" not "threejs")
2. Pick the best match by: exact name match, description relevance, code snippet count, source reputation (High/Medium preferred), and benchmark score (higher is better). Use version-specific IDs when the user mentions a version
3. \`query-docs\` with the selected library ID and what to look up in the library's documentation (not single words), scoped to a single concept. If the question spans multiple distinct concepts (e.g. routing and auth and caching), make a separate \`query-docs\` call per concept with the same library ID, unless the question is about how the concepts interact — combined queries dilute ranking and return shallow results for each topic
4. Answer using the fetched docs

## Library source code

If the \`query-code\` tool is available, use it when the docs do not answer an exact question: a signature or type, a default value, an option name, where an error message comes from, or how something works inside.

- Use a library ID that \`resolve-library-id\` marks with "Source code", usually the GitHub repository (e.g. \`/colinhacks/zod\`). \`/websites/...\` and \`/llmstxt/...\` IDs have no source
- Start with \`grep\` (set \`fixed_strings\` for error messages) or \`definition\` for a symbol, then \`read\` the file range in the result's "Next:" line
- For a version, pass its git tag in \`version\` (e.g. \`v3.24.2\`)
- Most questions need 1 to 4 \`query-code\` calls; stop at 6
- If it answers "being indexed", retry at most twice, then answer from \`query-docs\`
- Cite the file and line of the source you used
`;

const FALLBACK_CLI = `Use the \`ctx7\` CLI to fetch current documentation whenever the user asks about a library, framework, SDK, API, CLI tool, or cloud service — even well-known ones like React, Next.js, Prisma, Express, Tailwind, Django, or Spring Boot. This includes API syntax, configuration, version migration, porting code between libraries, platforms, or SQL dialects, library-specific debugging, setup instructions, and CLI tool usage. Use even when you think you know the answer — your training data may not reflect recent changes. Prefer this over web search for library docs.

Do not use for: refactoring, debugging, or reviewing code that does not depend on a library or platform API, or general programming concepts.

## Steps

1. Resolve library: \`npx ctx7@latest library <name> "<what to look up>"\`
2. Pick the best match by: exact name match, description relevance, code snippet count, source reputation (High/Medium preferred), and benchmark score (higher is better). If results don't look right, try the full name with punctuation (e.g., "next.js" not "nextjs")
3. Fetch docs: \`npx ctx7@latest docs <libraryId> "<what to look up>"\` — run a separate \`docs\` command per distinct concept if the question spans multiple topics, unless it's about how they interact
4. Answer using the fetched documentation

## Library source code

When the docs do not answer an exact question (a signature or type, a default value, an option name, where an error message comes from, or how something works inside), search the library's source at the docs version.

- Grep: \`npx ctx7@latest code <libraryId> "<regex>"\`. Add \`-F\` for plain text such as error messages
- Definition: \`npx ctx7@latest code <libraryId> <symbol> --op definition\`. Read code: \`npx ctx7@latest code <libraryId> --op read --path <file>#L10-L40\`. \`--op references\`, \`--op outline\` and \`--op list\` also exist
- Use an ID that \`library\` marks with "Source code", usually the GitHub repository. \`/websites/...\` and \`/llmstxt/...\` IDs have no source
- For a version, add the git tag to the library ID (e.g. \`/colinhacks/zod/v3.24.2\`). A tag that is not a docs version is indexed first (exit code 75). If indexing fails, the output lists the docs versions you can use
- Follow the \`Next:\` line of the output. Its fields map to flags: \`offset\` is \`--offset\`, \`output_mode "count"\` is \`-c\`, \`fixed_strings\` is \`-F\`, \`ignore_case\` is \`-i\`, \`read: <file>#L..\` is \`--op read --path <file>#L..\`, and the other fields use the flag of the same name (\`head_limit\` is \`--head-limit\`, \`version\` is \`--tag\`)
- Exit code 75 means the source is being indexed: retry at most twice, then answer from \`docs\`
- Cite the file and line of the source you used

You MUST call \`library\` first to get a valid ID (format: \`/org/project\`) unless the user provides one directly. Be specific about what to look up in the library's documentation — specific and detailed queries return better results than vague single words, but keep each query to a single concept unless the question is about how concepts interact; combined multi-topic queries dilute ranking and return shallow results for each topic. Do not run more than 3 \`library\` and \`docs\` commands per question, and not more than 6 \`code\` commands. Do not include sensitive information (API keys, passwords, credentials) in queries.

For version-specific docs, use \`/org/project/version\` from the \`library\` output (e.g., \`/vercel/next.js/v16.2.9\`).

If a command fails with a quota error, inform the user and suggest \`npx ctx7@latest login\` or setting \`CONTEXT7_API_KEY\` env var for higher limits. Do not silently fall back to training data.
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
