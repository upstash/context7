import { Command } from "commander";
import pc from "picocolors";
import ora from "ora";
import { select } from "@inquirer/prompts";
import { mkdir, readFile, writeFile } from "fs/promises";
import { dirname, join } from "path";
import { randomBytes } from "crypto";

import { log } from "../utils/logger.js";
import { checkboxWithHover } from "../utils/prompts.js";
import { trackEvent } from "../utils/tracking.js";
import { getBaseUrl, downloadSkill } from "../utils/api.js";
import { installSkillFiles } from "../utils/installer.js";
import { performLogin } from "./auth.js";
import { saveTokens, getValidAccessToken } from "../utils/auth.js";
import {
  type SetupAgent,
  type AuthOptions,
  SETUP_AGENT_NAMES,
  AUTH_MODE_LABELS,
  ALL_AGENT_NAMES,
  getAgent,
  detectAgents,
} from "../setup/agents.js";
import { customizeSkillFilesForAgent, getRuleContent } from "../setup/templates.js";
import {
  readJsonConfig,
  mergeServerEntry,
  writeJsonConfig,
  resolveMcpPath,
  appendTomlServer,
} from "../setup/mcp-writer.js";

type Scope = "global" | "project";
type SetupMode = "mcp" | "cli";

interface SetupOptions {
  claude?: boolean;
  cursor?: boolean;
  universal?: boolean;
  antigravity?: boolean;
  opencode?: boolean;
  codex?: boolean;
  gemini?: boolean;
  project?: boolean;
  yes?: boolean;
  apiKey?: string;
  oauth?: boolean;
  cli?: boolean;
  mcp?: boolean;
}

const CHECKBOX_THEME = {
  style: {
    highlight: (text: string) => pc.green(text),
    disabledChoice: (text: string) => ` ${pc.dim("◯")} ${pc.dim(text)}`,
  },
};

function getSelectedAgents(options: SetupOptions): SetupAgent[] {
  const agents: SetupAgent[] = [];
  if (options.claude) agents.push("claude");
  if (options.cursor) agents.push("cursor");
  if (options.opencode) agents.push("opencode");
  if (options.codex) agents.push("codex");
  if (options.gemini) agents.push("gemini");
  return agents;
}

export function registerSetupCommand(program: Command): void {
  program
    .command("setup")
    .description("Set up Context7 for your AI coding agent")
    .option("--claude", "Set up for Claude Code")
    .option("--cursor", "Set up for Cursor")
    .option("--universal", "Set up for Universal (.agents/skills)")
    .option("--antigravity", "Set up for Antigravity (.agent/skills)")
    .option("--opencode", "Set up for OpenCode")
    .option("--codex", "Set up for Codex")
    .option("--gemini", "Set up for Gemini CLI")
    .option("--mcp", "Set up MCP server mode")
    .option("--cli", "Set up CLI + Skills mode (no MCP server)")
    .option("-p, --project", "Configure for current project instead of globally")
    .option("-y, --yes", "Skip confirmation prompts")
    .option("--api-key <key>", "Use API key authentication")
    .option("--oauth", "Use OAuth endpoint (IDE handles auth flow)")
    .action(async (options: SetupOptions) => {
      await setupCommand(options);
    });
}

async function authenticateAndGenerateKey(): Promise<string | null> {
  const accessToken = (await getValidAccessToken()) ?? (await performLogin());

  if (!accessToken) return null;

  const spinner = ora("Configuring authentication...").start();

  try {
    const response = await fetch(`${getBaseUrl()}/api/dashboard/api-keys`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: `ctx7-cli-${randomBytes(3).toString("hex")}` }),
    });

    if (!response.ok) {
      const err = (await response.json().catch(() => ({}))) as { message?: string; error?: string };
      spinner.fail("Authentication failed");
      log.error(err.message || err.error || `HTTP ${response.status}`);
      return null;
    }

    const result = (await response.json()) as { data: { apiKey: string } };
    spinner.succeed("Authenticated");
    return result.data.apiKey;
  } catch (err) {
    spinner.fail("Authentication failed");
    log.error(err instanceof Error ? err.message : String(err));
    return null;
  }
}

async function resolveAuth(options: SetupOptions): Promise<AuthOptions | null> {
  if (options.apiKey) return { mode: "api-key", apiKey: options.apiKey };
  if (options.oauth) return { mode: "oauth" };

  const apiKey = await authenticateAndGenerateKey();
  if (!apiKey) return null;
  return { mode: "api-key", apiKey };
}

async function resolveMode(options: SetupOptions): Promise<SetupMode> {
  if (options.cli) return "cli";
  if (options.mcp || options.yes || options.oauth || options.apiKey) return "mcp";

  return select<SetupMode>({
    message: "How should your agent access Context7?",
    choices: [
      {
        name: `MCP server\n    ${pc.dim("Agent calls Context7 tools via MCP protocol to retrieve up-to-date library docs")}`,
        value: "mcp" as SetupMode,
      },
      {
        name: `CLI + Skills\n    ${pc.dim("Installs a find-docs skill that guides your agent to fetch up-to-date library docs using ")}${pc.dim(pc.bold("ctx7"))}${pc.dim(" CLI commands")}`,
        value: "cli" as SetupMode,
      },
    ],
    theme: {
      style: {
        highlight: (text: string) => pc.green(text),
        answer: (text: string) => pc.green(text.split("\n")[0].trim()),
      },
    },
  });
}

async function resolveCliAuth(apiKey?: string): Promise<void> {
  if (apiKey) {
    saveTokens({ access_token: apiKey, token_type: "bearer" });
    log.blank();
    log.plain(`${pc.green("✔")} Authenticated`);
    return;
  }

  const validToken = await getValidAccessToken();
  if (validToken) {
    log.blank();
    log.plain(`${pc.green("✔")} Authenticated`);
    return;
  }

  await performLogin();
}

async function promptAgents(): Promise<SetupAgent[] | null> {
  const choices = ALL_AGENT_NAMES.map((name) => ({
    name: SETUP_AGENT_NAMES[name],
    value: name,
  }));

  const message = "Which agents do you want to set up?";

  try {
    return await checkboxWithHover(
      {
        message,
        choices,
        loop: false,
        theme: CHECKBOX_THEME,
      },
      { getName: (a: SetupAgent) => SETUP_AGENT_NAMES[a] }
    );
  } catch {
    return null;
  }
}

async function resolveAgents(options: SetupOptions, scope: Scope): Promise<SetupAgent[]> {
  const explicit = getSelectedAgents(options);
  if (explicit.length > 0) return explicit;

  const detected = await detectAgents(scope);

  if (detected.length > 0 && options.yes) return detected;

  log.blank();
  const selected = await promptAgents();
  if (!selected) {
    log.warn("Setup cancelled");
    return [];
  }
  return selected;
}

/** Install a rule for an agent, handling both "file" (standalone) and "append" (AGENTS.md) types. */
async function installRule(
  agentName: SetupAgent,
  mode: SetupMode,
  scope: Scope
): Promise<{ status: string; path: string }> {
  const agent = getAgent(agentName);
  const rule = agent.rule;
  const content = await getRuleContent(mode, agentName);

  if (rule.kind === "file") {
    const ruleDir =
      scope === "global" ? rule.dir("global") : join(process.cwd(), rule.dir("project"));
    const rulePath = join(ruleDir, rule.filename);
    await mkdir(dirname(rulePath), { recursive: true });
    await writeFile(rulePath, content, "utf-8");
    return { status: "installed", path: rulePath };
  }

  const filePath =
    scope === "global" ? rule.file("global") : join(process.cwd(), rule.file("project"));
  const escapedMarker = rule.sectionMarker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const section = `${rule.sectionMarker}\n${content}${rule.sectionMarker}`;

  let existing = "";
  try {
    existing = await readFile(filePath, "utf-8");
  } catch {
    // File doesn't exist yet
  }

  if (existing.includes(rule.sectionMarker)) {
    const regex = new RegExp(`${escapedMarker}\\n[\\s\\S]*?${escapedMarker}`);
    const updated = existing.replace(regex, section);
    await writeFile(filePath, updated, "utf-8");
    return { status: "updated", path: filePath };
  }

  const separator =
    existing.length > 0 && !existing.endsWith("\n") ? "\n\n" : existing.length > 0 ? "\n" : "";
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, existing + separator + section + "\n", "utf-8");
  return { status: "installed", path: filePath };
}

async function setupAgent(
  agentName: SetupAgent,
  auth: AuthOptions,
  scope: Scope
): Promise<{
  agent: string;
  mcpStatus: string;
  mcpPath: string;
  ruleStatus: string;
  rulePath: string;
  skillStatus: string;
  skillPath: string;
}> {
  const agent = getAgent(agentName);

  const mcpCandidates =
    scope === "global"
      ? agent.mcp.globalPaths
      : agent.mcp.projectPaths.map((p) => join(process.cwd(), p));
  const mcpPath = await resolveMcpPath(mcpCandidates);

  let mcpStatus: string;
  try {
    if (mcpPath.endsWith(".toml")) {
      const { alreadyExists } = await appendTomlServer(
        mcpPath,
        "context7",
        agent.mcp.buildEntry(auth)
      );
      mcpStatus = alreadyExists
        ? `reconfigured with ${AUTH_MODE_LABELS[auth.mode]}`
        : `configured with ${AUTH_MODE_LABELS[auth.mode]}`;
    } else {
      const existing = await readJsonConfig(mcpPath);
      const { config, alreadyExists } = mergeServerEntry(
        existing,
        agent.mcp.configKey,
        "context7",
        agent.mcp.buildEntry(auth)
      );
      mcpStatus = alreadyExists
        ? `reconfigured with ${AUTH_MODE_LABELS[auth.mode]}`
        : `configured with ${AUTH_MODE_LABELS[auth.mode]}`;
      await writeJsonConfig(mcpPath, config);
    }
  } catch (err) {
    mcpStatus = `failed: ${err instanceof Error ? err.message : String(err)}`;
  }

  let ruleStatus: string;
  let rulePath: string;
  try {
    const result = await installRule(agentName, "mcp", scope);
    ruleStatus = result.status;
    rulePath = result.path;
  } catch (err) {
    ruleStatus = `failed: ${err instanceof Error ? err.message : String(err)}`;
    rulePath = "";
  }

  const skillDir =
    scope === "global"
      ? agent.skill.dir("global")
      : join(process.cwd(), agent.skill.dir("project"));
  const skillPath = join(skillDir, agent.skill.name, "SKILL.md");

  let skillStatus: string;
  try {
    const downloadData = await downloadSkill("/upstash/context7", agent.skill.name);
    if (downloadData.error || downloadData.files.length === 0) {
      throw new Error(downloadData.error || "no files");
    }
    await installSkillFiles(agent.skill.name, downloadData.files, skillDir);
    skillStatus = "installed";
  } catch (err) {
    skillStatus = `failed: ${err instanceof Error ? err.message : String(err)}`;
  }

  return {
    agent: agent.displayName,
    mcpStatus,
    mcpPath,
    ruleStatus,
    rulePath,
    skillStatus,
    skillPath,
  };
}

async function setupMcp(agents: SetupAgent[], options: SetupOptions, scope: Scope): Promise<void> {
  const auth = await resolveAuth(options);
  if (!auth) {
    log.warn("Setup cancelled");
    return;
  }

  log.blank();
  const spinner = ora("Setting up Context7...").start();

  const results = [];
  for (const agentName of agents) {
    spinner.text = `Setting up ${getAgent(agentName).displayName}...`;
    results.push(await setupAgent(agentName, auth, scope));
  }

  spinner.succeed("Context7 setup complete");

  log.blank();
  for (const r of results) {
    log.plain(`  ${pc.bold(r.agent)}`);
    const mcpIcon =
      r.mcpStatus.startsWith("configured") || r.mcpStatus.startsWith("reconfigured")
        ? pc.green("+")
        : pc.dim("~");
    log.plain(`    ${mcpIcon} MCP server ${r.mcpStatus}`);
    log.plain(`      ${pc.dim(r.mcpPath)}`);
    const ruleIcon = r.ruleStatus === "installed" ? pc.green("+") : pc.dim("~");
    log.plain(`    ${ruleIcon} Rule ${r.ruleStatus}`);
    log.plain(`      ${pc.dim(r.rulePath)}`);
    const skillIcon = r.skillStatus === "installed" ? pc.green("+") : pc.dim("~");
    log.plain(`    ${skillIcon} Skill ${r.skillStatus}`);
    log.plain(`      ${pc.dim(r.skillPath)}`);
    if (r.skillStatus.includes("EACCES")) {
      log.plain(
        `      ${pc.yellow("tip:")} fix permissions with: ${pc.cyan(`sudo chown -R $(whoami) ${dirname(dirname(r.skillPath))}`)}`
      );
    }
  }
  log.blank();

  trackEvent("setup", { agents, scope, authMode: auth.mode });
  trackEvent("install", { skills: ["/upstash/context7/context7-mcp"], ides: agents });
}

async function setupCliAgent(
  agentName: SetupAgent,
  scope: Scope,
  downloadData: { files: Array<{ path: string; content: string }> }
): Promise<{ skillPath: string; skillStatus: string; rulePath: string; ruleStatus: string }> {
  const agent = getAgent(agentName);

  const skillDir =
    scope === "global"
      ? agent.skill.dir("global")
      : join(process.cwd(), agent.skill.dir("project"));
  let skillStatus: string;
  try {
    const files = customizeSkillFilesForAgent(agentName, "find-docs", downloadData.files);
    await installSkillFiles("find-docs", files, skillDir);
    skillStatus = "installed";
  } catch (err) {
    skillStatus = `failed: ${err instanceof Error ? err.message : String(err)}`;
  }
  const skillPath = join(skillDir, "find-docs");

  let ruleStatus: string;
  let rulePath: string;
  try {
    const result = await installRule(agentName, "cli", scope);
    ruleStatus = result.status;
    rulePath = result.path;
  } catch (err) {
    ruleStatus = `failed: ${err instanceof Error ? err.message : String(err)}`;
    rulePath = "";
  }

  return { skillPath, skillStatus, rulePath, ruleStatus };
}

async function setupCli(options: SetupOptions): Promise<void> {
  await resolveCliAuth(options.apiKey);

  const scope: Scope = options.project ? "project" : "global";
  const agents = await resolveAgents(options, scope);
  if (agents.length === 0) return;

  log.blank();
  const spinner = ora("Downloading find-docs skill...").start();

  const downloadData = await downloadSkill("/upstash/context7", "find-docs");
  if (downloadData.error || downloadData.files.length === 0) {
    spinner.fail(`Failed to download find-docs skill: ${downloadData.error || "no files"}`);
    return;
  }

  spinner.succeed("Downloaded find-docs skill");

  const installSpinner = ora("Installing...").start();
  const results: Array<{
    agent: string;
    skillPath: string;
    skillStatus: string;
    rulePath: string;
    ruleStatus: string;
  }> = [];

  for (const agentName of agents) {
    installSpinner.text = `Setting up ${getAgent(agentName).displayName}...`;
    const r = await setupCliAgent(agentName, scope, downloadData);
    results.push({ agent: getAgent(agentName).displayName, ...r });
  }

  installSpinner.succeed("Context7 CLI setup complete");

  log.blank();
  for (const r of results) {
    log.plain(`  ${pc.bold(r.agent)}`);
    const skillIcon = r.skillStatus === "installed" ? pc.green("+") : pc.dim("~");
    log.plain(`    ${skillIcon} Skill ${r.skillStatus}`);
    log.plain(`      ${pc.dim(r.skillPath)}`);
    if (r.skillStatus.includes("EACCES")) {
      log.plain(
        `      ${pc.yellow("tip:")} fix permissions with: ${pc.cyan(`sudo chown -R $(whoami) ${dirname(dirname(r.skillPath))}`)}`
      );
    }
    const ruleIcon =
      r.ruleStatus === "installed" || r.ruleStatus === "updated" ? pc.green("+") : pc.dim("~");
    log.plain(`    ${ruleIcon} Rule ${r.ruleStatus}`);
    log.plain(`      ${pc.dim(r.rulePath)}`);
  }
  log.blank();

  trackEvent("setup", { mode: "cli" });
  trackEvent("install", { skills: ["/upstash/context7/find-docs"], ides: agents });
}

async function setupCommand(options: SetupOptions): Promise<void> {
  trackEvent("command", { name: "setup" });

  try {
    const mode = await resolveMode(options);
    if (mode === "mcp") {
      const scope: Scope = options.project ? "project" : "global";
      const agents = await resolveAgents(options, scope);
      if (agents.length === 0) return;
      await setupMcp(agents, options, scope);
    } else {
      await setupCli(options);
    }
  } catch (err) {
    if (err instanceof Error && err.name === "ExitPromptError") process.exit(0);
    throw err;
  }
}
