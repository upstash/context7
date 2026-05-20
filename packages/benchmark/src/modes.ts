import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { ModeConfig } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function findProjectRoot(): string {
  let dir = __dirname;
  for (let i = 0; i < 5; i++) {
    try {
      const pkg = JSON.parse(readFileSync(resolve(dir, "package.json"), "utf-8"));
      if (pkg.name === "@upstash/context7") return dir;
    } catch {}
    dir = dirname(dir);
  }
  throw new Error("Could not find project root (looking for @upstash/context7 package.json)");
}

export const PROJECT_ROOT = findProjectRoot();

const RULES_DIR = resolve(PROJECT_ROOT, "rules");
export const MCP_INSTRUCTIONS = readFileSync(resolve(RULES_DIR, "context7-mcp.md"), "utf-8");
export const CLI_INSTRUCTIONS = readFileSync(resolve(RULES_DIR, "context7-cli.md"), "utf-8");

function gitShow(path: string, ref = "master"): string {
  return execSync(`git show ${ref}:${path}`, {
    encoding: "utf-8",
    cwd: PROJECT_ROOT,
  });
}

const PROD_MCP_INSTRUCTIONS = gitShow("rules/context7-mcp.md");
const PROD_CLI_INSTRUCTIONS = gitShow("rules/context7-cli.md");
const PROD_SKILL_CONTENT = gitShow("skills/find-docs/SKILL.md");

export const MODE_CONFIGS: Record<string, ModeConfig> = {
  "nia:prod": {
    mcp: false,
    rule: false,
    skill: false,
    claudeMd: false,
    ruleContent: null,
    claudeMdContent: null,
    detection: "nia",
    nia: true,
    description: "Nia MCP only, no Context7",
  },
  "vs:cli": {
    mcp: false,
    rule: true,
    skill: true,
    claudeMd: false,
    ruleContent: PROD_CLI_INSTRUCTIONS,
    claudeMdContent: null,
    detection: "versus",
    skillContent: PROD_SKILL_CONTENT,
    niaSkill: true,
    description: "Context7 CLI (prod) + Nia skill side by side",
  },
  "vs:mcp": {
    mcp: true,
    rule: true,
    skill: false,
    claudeMd: false,
    ruleContent: PROD_MCP_INSTRUCTIONS,
    claudeMdContent: null,
    detection: "versus",
    nia: true,
    description: "Context7 MCP (prod) + Nia MCP side by side",
  },
  "mcp:prod": {
    mcp: true,
    rule: true,
    skill: false,
    claudeMd: false,
    ruleContent: PROD_MCP_INSTRUCTIONS,
    claudeMdContent: null,
    detection: "mcp",
    description: "Prod MCP: npm server + rule from master",
  },
  "mcp:dev": {
    mcp: true,
    rule: true,
    skill: false,
    claudeMd: false,
    ruleContent: MCP_INSTRUCTIONS,
    claudeMdContent: null,
    detection: "mcp",
    useLocalMcp: true,
    description: "Dev MCP: local build + rule from working tree",
  },
  "cli:prod": {
    mcp: false,
    rule: true,
    skill: true,
    claudeMd: false,
    ruleContent: PROD_CLI_INSTRUCTIONS,
    claudeMdContent: null,
    detection: "skill",
    skillContent: PROD_SKILL_CONTENT,
    description: "Prod CLI: skill + rule from master",
  },
  "cli:dev": {
    mcp: false,
    rule: true,
    skill: true,
    claudeMd: false,
    ruleContent: CLI_INSTRUCTIONS,
    claudeMdContent: null,
    detection: "skill",
    description: "Dev CLI: skill + rule from working tree",
  },
  mcp: {
    mcp: true,
    rule: false,
    skill: false,
    claudeMd: false,
    ruleContent: null,
    claudeMdContent: null,
    detection: "mcp",
    description: "MCP server only, no rule",
  },
  "mcp+rule": {
    mcp: true,
    rule: true,
    skill: false,
    claudeMd: false,
    ruleContent: MCP_INSTRUCTIONS,
    claudeMdContent: null,
    detection: "mcp",
    description: "MCP server + alwaysApply rule",
  },
  "mcp+claude.md": {
    mcp: true,
    rule: false,
    skill: false,
    claudeMd: true,
    ruleContent: null,
    claudeMdContent: MCP_INSTRUCTIONS,
    detection: "mcp",
    description: "MCP server + CLAUDE.md",
  },
  "cli+skill": {
    mcp: false,
    rule: false,
    skill: true,
    claudeMd: false,
    ruleContent: null,
    claudeMdContent: null,
    detection: "skill",
    description: "find-docs SKILL.md only",
  },
  "cli+claude.md": {
    mcp: false,
    rule: false,
    skill: false,
    claudeMd: true,
    ruleContent: null,
    claudeMdContent: CLI_INSTRUCTIONS,
    detection: "cli",
    description: "CLAUDE.md with ctx7 CLI instructions",
  },
  "cli+rule": {
    mcp: false,
    rule: true,
    skill: false,
    claudeMd: false,
    ruleContent: CLI_INSTRUCTIONS,
    claudeMdContent: null,
    detection: "cli",
    description: "alwaysApply rule with ctx7 CLI instructions",
  },
};

export const CONTEXT_PREFIXES = [
  "I've been working on this codebase for a while. So far I:\n" +
    "- Read through src/routes/api.ts and fixed the auth middleware\n" +
    "- Ran the test suite, 3 tests are still failing\n" +
    "- Updated package.json dependencies\n\n" +
    "Now: ",
  "I'm in the middle of a refactor. Just finished:\n" +
    "- Moved the database models to a new directory\n" +
    "- Fixed the import paths in 12 files\n" +
    "- The CI is green now\n\n" +
    "Quick question: ",
  "Been debugging this for an hour. Already tried:\n" +
    "- Checked the logs, nothing obvious\n" +
    "- Added some console.logs in the handler\n" +
    "- Restarted the dev server\n\n" +
    "Anyway, unrelated but: ",
  "Just got off a call with the team. Before I forget: ",
  "Working through my backlog today. Next up: ",
];
