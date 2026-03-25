// Source of truth: /rules/context7-mcp.md and /rules/context7-cli.md in the repo.
// Fetched from GitHub at runtime, trying master first then the release branch.
const GITHUB_RAW_URLS = [
  "https://raw.githubusercontent.com/upstash/context7/master/rules",
  "https://raw.githubusercontent.com/upstash/context7/main/rules",
  "https://raw.githubusercontent.com/upstash/context7/ctx7-1435-ctx7-setup-install-rules-alongside-skills-in-cli-mode-and/rules",
];

const CURSOR_FRONTMATTER = `---\nalwaysApply: true\n---\n\n`;

export type RuleMode = "mcp" | "cli";

async function fetchRule(filename: string): Promise<string> {
  for (const base of GITHUB_RAW_URLS) {
    try {
      const res = await fetch(`${base}/${filename}`);
      if (res.ok) return await res.text();
    } catch {
      continue;
    }
  }
  throw new Error(`Failed to fetch rule ${filename} from any branch`);
}

export async function getRuleContent(mode: RuleMode, agent: string): Promise<string> {
  const filename = mode === "mcp" ? "context7-mcp.md" : "context7-cli.md";
  const body = await fetchRule(filename);
  return agent === "cursor" ? `${CURSOR_FRONTMATTER}${body}` : body;
}
