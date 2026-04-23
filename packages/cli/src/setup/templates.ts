const GITHUB_RAW_URLS = [
  "https://raw.githubusercontent.com/upstash/context7/master/rules",
  "https://raw.githubusercontent.com/upstash/context7/main/rules",
];

const FALLBACK_MCP = `Use Context7 MCP to fetch current documentation whenever the user asks about a library, framework, SDK, API, CLI tool, or cloud service -- even well-known ones like React, Next.js, Prisma, Express, Tailwind, Django, or Spring Boot. This includes API syntax, configuration, version migration, library-specific debugging, setup instructions, and CLI tool usage. Use even when you think you know the answer -- your training data may not reflect recent changes. Prefer this over web search for library docs.

Do not use for: refactoring, writing scripts from scratch, debugging business logic, code review, or general programming concepts.

## Steps

1. \`resolve-library-id\` with the library name and the user's question. Use the official library name with proper punctuation (e.g., "Next.js" not "nextjs", "Customer.io" not "customerio", "Three.js" not "threejs")
2. Pick the best match by: exact name match, description relevance, code snippet count, source reputation (High/Medium preferred), and benchmark score (higher is better). Use version-specific IDs when the user mentions a version
3. \`query-docs\` with the selected library ID and the user's full question (not single words)
4. If you weren't satisfied with the answer, call \`query-docs\` again for the same library with \`researchMode: true\`. This retries with sandboxed agents that git-pull the actual source repos plus a live web search, then synthesizes a fresh answer. More costly than the default
5. Answer using the fetched docs
`;

const FALLBACK_CLI = `Use the \`ctx7\` CLI to fetch current documentation whenever the user asks about a library, framework, SDK, API, CLI tool, or cloud service -- even well-known ones like React, Next.js, Prisma, Express, Tailwind, Django, or Spring Boot. This includes API syntax, configuration, version migration, library-specific debugging, setup instructions, and CLI tool usage. Use even when you think you know the answer -- your training data may not reflect recent changes. Prefer this over web search for library docs.

Do not use for: refactoring, writing scripts from scratch, debugging business logic, code review, or general programming concepts.

## Steps

1. Resolve library: \`npx ctx7@latest library <name> "<user's question>"\`
2. Pick the best match by: exact name match, description relevance, code snippet count, source reputation (High/Medium preferred), and benchmark score (higher is better). If results don't look right, try the full name with punctuation (e.g., "next.js" not "nextjs")
3. Fetch docs: \`npx ctx7@latest docs <libraryId> "<user's question>"\`
4. If you weren't satisfied with the answer, re-run the same command with \`--research\`. This retries with sandboxed agents that git-pull the actual source repos plus a live web search, then synthesizes a fresh answer. More costly than the default
5. Answer using the fetched documentation

You MUST call \`library\` first to get a valid ID (format: \`/org/project\`) unless the user provides one directly. Use the user's full question as the query -- specific and detailed queries return better results than vague single words. Do not run more than 3 commands per question. Do not include sensitive information (API keys, passwords, credentials) in queries.

For version-specific docs, use \`/org/project/version\` from the \`library\` output (e.g., \`/vercel/next.js/v14.3.0\`).

If a command fails with a quota error, inform the user and suggest \`npx ctx7@latest login\` or setting \`CONTEXT7_API_KEY\` env var for higher limits. Do not silently fall back to training data.
`;

const CURSOR_FRONTMATTER = `---\nalwaysApply: true\n---\n\n`;
const CODEX_CLI_SANDBOX_GUIDANCE = `Run Context7 CLI requests outside Codex's default sandbox. If a Context7 CLI command fails with DNS or network errors such as ENOTFOUND, host resolution failures, or fetch failed, rerun it outside the sandbox instead of retrying inside the sandbox.`;

export type RuleMode = "mcp" | "cli";

async function fetchRule(filename: string, fallback: string): Promise<string> {
  for (const base of GITHUB_RAW_URLS) {
    try {
      const res = await fetch(`${base}/${filename}`);
      if (res.ok) return await res.text();
    } catch {
      continue;
    }
  }
  return fallback;
}

export async function getRuleContent(mode: RuleMode, agent: string): Promise<string> {
  const [filename, fallback] =
    mode === "mcp" ? ["context7-mcp.md", FALLBACK_MCP] : ["context7-cli.md", FALLBACK_CLI];
  let body = await fetchRule(filename, fallback);

  if (mode === "cli" && agent === "codex" && !body.includes(CODEX_CLI_SANDBOX_GUIDANCE)) {
    body = `${body.trimEnd()}\n${CODEX_CLI_SANDBOX_GUIDANCE}\n`;
  }

  return agent === "cursor" ? `${CURSOR_FRONTMATTER}${body}` : body;
}

export function customizeSkillFilesForAgent(
  agent: string,
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
