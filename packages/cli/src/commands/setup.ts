import { Command } from "commander";
import pc from "picocolors";
import ora from "ora";
import { select } from "@inquirer/prompts";
import { mkdir, writeFile } from "fs/promises";
import { dirname, join } from "path";
import { randomBytes } from "crypto";

import { log } from "../utils/logger.js";
import { checkboxWithHover } from "../utils/prompts.js";
import { trackEvent } from "../utils/tracking.js";
import { getBaseUrl, downloadSkill } from "../utils/api.js";
import { installSkillFiles } from "../utils/installer.js";
import { promptForInstallTargets, getTargetDirs } from "../utils/ide.js";
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
import { RULE_CONTENT } from "../setup/templates.js";
import {
  readJsonConfig,
  mergeServerEntry,
  mergeInstructions,
  writeJsonConfig,
} from "../setup/mcp-writer.js";

type Scope = "global" | "project";
type SetupMode = "mcp" | "cli";

interface SetupOptions {
  claude?: boolean;
  cursor?: boolean;
  universal?: boolean;
  antigravity?: boolean;
  opencode?: boolean;
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

async function isAlreadyConfigured(agentName: SetupAgent, scope: Scope): Promise<boolean> {
  const agent = getAgent(agentName);
  const mcpPath =
    scope === "global" ? agent.mcp.globalPath : join(process.cwd(), agent.mcp.projectPath);
  try {
    const existing = await readJsonConfig(mcpPath);
    const section = (existing[agent.mcp.configKey] as Record<string, unknown> | undefined) ?? {};
    return "context7" in section;
  } catch {
    return false;
  }
}

async function promptAgents(scope: Scope, mode: SetupMode): Promise<SetupAgent[] | null> {
  const choices = await Promise.all(
    ALL_AGENT_NAMES.map(async (name) => {
      const configured = mode === "mcp" ? await isAlreadyConfigured(name, scope) : false;
      return {
        name: SETUP_AGENT_NAMES[name],
        value: name,
        disabled: configured ? "(already configured)" : false,
      };
    })
  );

  if (choices.every((c) => c.disabled)) {
    log.info("Context7 is already configured for all detected agents.");
    return null;
  }

  const message =
    mode === "cli"
      ? "Install find-docs skill for which agents?"
      : "Which agents do you want to set up?";

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

async function resolveAgents(
  options: SetupOptions,
  scope: Scope,
  mode: SetupMode = "mcp"
): Promise<SetupAgent[]> {
  const explicit = getSelectedAgents(options);
  if (explicit.length > 0) return explicit;

  const detected = await detectAgents(scope);

  if (detected.length > 0 && options.yes) return detected;

  log.blank();
  const selected = await promptAgents(scope, mode);
  if (!selected) {
    log.warn("Setup cancelled");
    return [];
  }
  return selected;
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

  const mcpPath =
    scope === "global" ? agent.mcp.globalPath : join(process.cwd(), agent.mcp.projectPath);

  let mcpStatus: string;
  try {
    const existing = await readJsonConfig(mcpPath);
    const { config, alreadyExists } = mergeServerEntry(
      existing,
      agent.mcp.configKey,
      "context7",
      agent.mcp.buildEntry(auth)
    );

    if (alreadyExists) {
      mcpStatus = "already configured";
    } else {
      mcpStatus = `configured with ${AUTH_MODE_LABELS[auth.mode]}`;
    }

    const finalConfig = agent.rule.instructionsGlob
      ? mergeInstructions(config, agent.rule.instructionsGlob(scope))
      : config;

    if (finalConfig !== existing) {
      await writeJsonConfig(mcpPath, finalConfig);
    }
  } catch (err) {
    mcpStatus = `failed: ${err instanceof Error ? err.message : String(err)}`;
  }

  const rulePath =
    scope === "global"
      ? join(agent.rule.dir("global"), agent.rule.filename)
      : join(process.cwd(), agent.rule.dir("project"), agent.rule.filename);

  let ruleStatus: string;
  try {
    await mkdir(dirname(rulePath), { recursive: true });
    await writeFile(rulePath, RULE_CONTENT, "utf-8");
    ruleStatus = "installed";
  } catch (err) {
    ruleStatus = `failed: ${err instanceof Error ? err.message : String(err)}`;
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
    const mcpIcon = r.mcpStatus.startsWith("configured") ? pc.green("+") : pc.dim("~");
    log.plain(`    ${mcpIcon} MCP server ${r.mcpStatus}`);
    log.plain(`      ${pc.dim(r.mcpPath)}`);
    const ruleIcon = r.ruleStatus === "installed" ? pc.green("+") : pc.dim("~");
    log.plain(`    ${ruleIcon} Rule ${r.ruleStatus}`);
    log.plain(`      ${pc.dim(r.rulePath)}`);
    const skillIcon = r.skillStatus === "installed" ? pc.green("+") : pc.dim("~");
    log.plain(`    ${skillIcon} Skill ${r.skillStatus}`);
    log.plain(`      ${pc.dim(r.skillPath)}`);
  }
  log.blank();

  trackEvent("setup", { agents, scope, authMode: auth.mode });
  trackEvent("install", { skills: ["/upstash/context7/context7-mcp"], ides: agents });
}

async function setupCli(options: SetupOptions): Promise<void> {
  await resolveCliAuth(options.apiKey);

  const targets = await promptForInstallTargets({ ...options, global: !options.project }, false);
  if (!targets) {
    log.warn("Setup cancelled");
    return;
  }

  log.blank();
  const spinner = ora("Downloading find-docs skill...").start();

  const downloadData = await downloadSkill("/upstash/context7", "find-docs");
  if (downloadData.error || downloadData.files.length === 0) {
    spinner.fail(`Failed to download find-docs skill: ${downloadData.error || "no files"}`);
    return;
  }

  spinner.succeed("Downloaded find-docs skill");

  const targetDirs = getTargetDirs(targets);
  const installSpinner = ora("Installing find-docs skill...").start();

  for (const dir of targetDirs) {
    installSpinner.text = `Installing to ${dir}...`;
    await installSkillFiles("find-docs", downloadData.files, dir);
  }

  installSpinner.stop();
  log.blank();
  log.plain(`${pc.green("✔")} Context7 CLI setup complete`);

  log.blank();
  for (const dir of targetDirs) {
    log.itemAdd(
      `find-docs  ${pc.dim("Guides your agent to fetch up-to-date library docs on demand using ctx7 CLI commands")}`
    );
    log.plain(`    ${pc.dim(dir)}`);
  }
  log.blank();
  log.plain(`  ${pc.bold("Next steps")}`);
  log.plain(`    Ask your agent: ${pc.cyan(`"Use ctx7 CLI to look up React hooks"`)}`);
  log.blank();

  trackEvent("setup", { mode: "cli" });
  trackEvent("install", { skills: ["/upstash/context7/find-docs"], ides: targets.ides });
}

async function setupCommand(options: SetupOptions): Promise<void> {
  trackEvent("command", { name: "setup" });

  try {
    const mode = await resolveMode(options);
    if (mode === "mcp") {
      const scope: Scope = options.project ? "project" : "global";
      const agents = await resolveAgents(options, scope, mode);
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
