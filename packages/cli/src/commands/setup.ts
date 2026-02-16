import { Command } from "commander";
import pc from "picocolors";
import ora from "ora";
import { mkdir, writeFile } from "fs/promises";
import { dirname, join } from "path";
import { randomBytes } from "crypto";

import { log } from "../utils/logger.js";
import { checkboxWithHover } from "../utils/prompts.js";
import { trackEvent } from "../utils/tracking.js";
import { getBaseUrl } from "../utils/api.js";
import { performLogin } from "./auth.js";
import { loadTokens, isTokenExpired } from "../utils/auth.js";
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
import { readJsonConfig, mergeServerEntry, mergeInstructions, writeJsonConfig } from "../setup/mcp-writer.js";

type Scope = "global" | "project";

interface SetupOptions {
  claude?: boolean;
  cursor?: boolean;
  opencode?: boolean;
  project?: boolean;
  yes?: boolean;
  apiKey?: string;
  oauth?: boolean;
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
    .description("Set up Context7 MCP and rule for your AI coding agent")
    .option("--claude", "Set up for Claude Code")
    .option("--cursor", "Set up for Cursor")
    .option("--opencode", "Set up for OpenCode")
    .option("-p, --project", "Configure for current project instead of globally")
    .option("-y, --yes", "Skip confirmation prompts")
    .option("--api-key <key>", "Use API key authentication")
    .option("--oauth", "Use OAuth endpoint (IDE handles auth flow)")
    .action(async (options: SetupOptions) => {
      await setupCommand(options);
    });
}

async function authenticateAndGenerateKey(): Promise<string | null> {
  const existingTokens = loadTokens();
  const accessToken =
    existingTokens && !isTokenExpired(existingTokens)
      ? existingTokens.access_token
      : await performLogin();

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

async function promptAgents(scope: Scope): Promise<SetupAgent[] | null> {
  const choices = await Promise.all(
    ALL_AGENT_NAMES.map(async (name) => {
      const configured = await isAlreadyConfigured(name, scope);
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

  try {
    return await checkboxWithHover(
      {
        message: "Which agents do you want to set up?",
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
  const selected = await promptAgents(scope);
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

  return { agent: agent.displayName, mcpStatus, mcpPath, ruleStatus, rulePath };
}

async function setupCommand(options: SetupOptions): Promise<void> {
  trackEvent("command", { name: "setup" });

  const scope: Scope = options.project ? "project" : "global";
  const agents = await resolveAgents(options, scope);
  if (agents.length === 0) return;

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
  }
  log.blank();

  trackEvent("setup", { agents, scope, authMode: auth.mode });
}
