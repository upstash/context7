import { Command } from "commander";
import pc from "picocolors";
import ora from "ora";
import { checkboxWithHover } from "../utils/prompts.js";
import { log } from "../utils/logger.js";
import { trackEvent } from "../utils/tracking.js";
import {
  ALL_AGENT_NAMES,
  SETUP_AGENT_NAMES,
  getAgent,
  detectAgents,
  type SetupAgent,
} from "../setup/agents.js";
import {
  readJsonConfig,
  removeServerEntry,
  writeJsonConfig,
  resolveMcpPath,
  removeTomlServer,
} from "../setup/mcp-writer.js";
import { join } from "path";
import { readFile, rm, writeFile } from "fs/promises";

type Scope = "global" | "project";
type UninstallMode = "mcp" | "cli";

interface UninstallOptions {
  claude?: boolean;
  cursor?: boolean;
  opencode?: boolean;
  codex?: boolean;
  gemini?: boolean;
  project?: boolean;
  yes?: boolean;
  all?: boolean;
  cli?: boolean;
  mcp?: boolean;
}

interface CleanupStatus {
  status: string;
  path: string;
}

interface SkillCleanupStatus extends CleanupStatus {
  name: string;
}

interface AgentCleanupResult {
  agent: string;
  mcp?: CleanupStatus;
  rule?: CleanupStatus;
  skills?: SkillCleanupStatus[];
}

const CHECKBOX_THEME = {
  style: {
    highlight: (text: string) => pc.green(text),
    disabledChoice: (text: string) => ` ${pc.dim("◯")} ${pc.dim(text)}`,
  },
};

const CONTEXT7_SECTION_MARKER = "<!-- context7 -->";
const MODE_SKILLS: Record<UninstallMode, readonly string[]> = {
  mcp: ["context7-mcp"],
  cli: ["find-docs"],
};

export function registerUninstallCommand(program: Command): void {
  program
    .command("remove")
    .alias("uninstall")
    .description("Remove Context7 setup from your AI coding agent")
    .option("--claude", "Remove from Claude Code")
    .option("--cursor", "Remove from Cursor")
    .option("--opencode", "Remove from OpenCode")
    .option("--codex", "Remove from Codex")
    .option("--gemini", "Remove from Gemini CLI")
    .option("--all", "Remove both MCP setup and CLI + Skills setup")
    .option("--mcp", "Remove MCP setup")
    .option("--cli", "Remove CLI + Skills setup")
    .option("-p, --project", "Remove from the current project instead of global config")
    .option("-y, --yes", "Skip confirmation prompts")
    .action(async (options: UninstallOptions) => {
      await uninstallCommand(options);
    });
}

function getSelectedAgents(options: UninstallOptions): SetupAgent[] {
  const agents: SetupAgent[] = [];
  if (options.claude) agents.push("claude");
  if (options.cursor) agents.push("cursor");
  if (options.opencode) agents.push("opencode");
  if (options.codex) agents.push("codex");
  if (options.gemini) agents.push("gemini");
  return agents;
}

async function promptAgents(): Promise<SetupAgent[] | null> {
  const choices = ALL_AGENT_NAMES.map((name) => ({
    name: SETUP_AGENT_NAMES[name],
    value: name,
  }));

  try {
    return await checkboxWithHover(
      {
        message: "Which agents do you want to clean up?",
        choices,
        loop: false,
        theme: CHECKBOX_THEME,
      },
      { getName: (agent: SetupAgent) => SETUP_AGENT_NAMES[agent] }
    );
  } catch {
    return null;
  }
}

async function resolveAgents(options: UninstallOptions, scope: Scope): Promise<SetupAgent[]> {
  const explicit = getSelectedAgents(options);
  if (explicit.length > 0) return explicit;

  const detected = await detectAgents(scope);
  if (detected.length > 0 && options.yes) return detected;

  if (detected.length === 0 && options.yes) {
    const message =
      "No supported agents detected. Pass --claude, --cursor, --opencode, --codex, or --gemini.";
    log.warn(message);
    return [];
  }

  log.blank();
  const selected = await promptAgents();
  if (!selected) {
    log.warn("Uninstall cancelled");
    return [];
  }

  return selected;
}

function resolveModes(options: UninstallOptions): UninstallMode[] {
  if (options.all) return ["mcp", "cli"];

  const selected: UninstallMode[] = [];

  if (options.mcp) selected.push("mcp");
  if (options.cli) selected.push("cli");

  return selected.length > 0 ? selected : ["mcp", "cli"];
}

async function uninstallMcp(agentName: SetupAgent, scope: Scope): Promise<CleanupStatus> {
  const agent = getAgent(agentName);
  const mcpCandidates =
    scope === "global"
      ? agent.mcp.globalPaths
      : agent.mcp.projectPaths.map((path) => join(process.cwd(), path));
  const mcpPath = await resolveMcpPath(mcpCandidates);

  try {
    if (mcpPath.endsWith(".toml")) {
      const { removed } = await removeTomlServer(mcpPath, "context7");
      return { status: removed ? "removed" : "not found", path: mcpPath };
    }

    const existing = await readJsonConfig(mcpPath);
    const { config, removed } = removeServerEntry(existing, agent.mcp.configKey, "context7");
    if (removed) {
      await writeJsonConfig(mcpPath, config);
    }
    return { status: removed ? "removed" : "not found", path: mcpPath };
  } catch (err) {
    return { status: `failed: ${err instanceof Error ? err.message : String(err)}`, path: mcpPath };
  }
}

async function uninstallRule(agentName: SetupAgent, scope: Scope): Promise<CleanupStatus> {
  const agent = getAgent(agentName);
  const rule = agent.rule;

  if (rule.kind === "file") {
    const rulePath =
      scope === "global" ? rule.dir("global") : join(process.cwd(), rule.dir("project"));
    const targetPath = join(rulePath, rule.filename);

    try {
      await rm(targetPath);
      return { status: "removed", path: targetPath };
    } catch (err) {
      const error = err as NodeJS.ErrnoException;
      if (error.code === "ENOENT") return { status: "not found", path: targetPath };
      return { status: `failed: ${error.message}`, path: targetPath };
    }
  }

  const filePath =
    scope === "global" ? rule.file("global") : join(process.cwd(), rule.file("project"));

  try {
    const existing = await readFile(filePath, "utf-8");
    if (!existing.includes(CONTEXT7_SECTION_MARKER)) {
      return { status: "not found", path: filePath };
    }

    const escapedMarker = CONTEXT7_SECTION_MARKER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const updated = existing
      .replace(new RegExp(`\\n?${escapedMarker}\\n[\\s\\S]*?${escapedMarker}\\n?`, "m"), "")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/^\n+/, "")
      .trimEnd();

    if (updated.length === 0) {
      await rm(filePath);
    } else {
      await writeFile(filePath, `${updated}\n`, "utf-8");
    }

    return { status: "removed", path: filePath };
  } catch (err) {
    const error = err as NodeJS.ErrnoException;
    if (error.code === "ENOENT") return { status: "not found", path: filePath };
    return { status: `failed: ${error.message}`, path: filePath };
  }
}

async function uninstallSkills(
  agentName: SetupAgent,
  scope: Scope,
  skillNames: readonly string[]
): Promise<SkillCleanupStatus[]> {
  const agent = getAgent(agentName);
  const skillsDir =
    scope === "global"
      ? agent.skill.dir("global")
      : join(process.cwd(), agent.skill.dir("project"));

  const results: SkillCleanupStatus[] = [];

  for (const skillName of skillNames) {
    const skillPath = join(skillsDir, skillName);
    try {
      await rm(skillPath, { recursive: true });
      results.push({ name: skillName, status: "removed", path: skillPath });
    } catch (err) {
      const error = err as NodeJS.ErrnoException;
      if (error.code === "ENOENT") {
        results.push({ name: skillName, status: "not found", path: skillPath });
      } else {
        results.push({ name: skillName, status: `failed: ${error.message}`, path: skillPath });
      }
    }
  }

  return results;
}

async function uninstallAgent(
  agentName: SetupAgent,
  scope: Scope,
  modes: UninstallMode[]
): Promise<AgentCleanupResult> {
  const result: AgentCleanupResult = { agent: getAgent(agentName).displayName };
  const skillNames = Array.from(new Set(modes.flatMap((mode) => [...MODE_SKILLS[mode]])));
  const shouldRemoveRule = modes.includes("mcp") || modes.includes("cli");

  if (modes.includes("mcp")) {
    result.mcp = await uninstallMcp(agentName, scope);
  }

  if (shouldRemoveRule) {
    result.rule = await uninstallRule(agentName, scope);
  }

  if (skillNames.length > 0) {
    result.skills = await uninstallSkills(agentName, scope, skillNames);
  }

  return result;
}

function iconForStatus(status: string): string {
  if (status === "removed") return pc.green("-");
  if (status === "not found") return pc.dim("~");
  return pc.red("!");
}

function printResults(results: AgentCleanupResult[], modes: UninstallMode[]): void {
  log.blank();
  const shouldPrintRule = modes.includes("mcp") || modes.includes("cli");

  for (const result of results) {
    log.plain(`  ${pc.bold(result.agent)}`);

    if (modes.includes("mcp") && result.mcp) {
      log.plain(`    ${iconForStatus(result.mcp.status)} MCP config ${result.mcp.status}`);
      log.plain(`      ${pc.dim(result.mcp.path)}`);
    }

    if (shouldPrintRule && result.rule) {
      log.plain(`    ${iconForStatus(result.rule.status)} Rule ${result.rule.status}`);
      log.plain(`      ${pc.dim(result.rule.path)}`);
    }

    if (result.skills) {
      for (const skill of result.skills) {
        log.plain(`    ${iconForStatus(skill.status)} Skill ${skill.name} ${skill.status}`);
        log.plain(`      ${pc.dim(skill.path)}`);
      }
    }
  }

  log.blank();
}

async function uninstallCommand(options: UninstallOptions): Promise<void> {
  trackEvent("command", { name: "uninstall" });

  const scope: Scope = options.project ? "project" : "global";
  const modes = resolveModes(options);
  const agents = await resolveAgents(options, scope);
  if (agents.length === 0) return;

  log.blank();
  const spinner = ora("Removing Context7 setup...").start();

  const results: AgentCleanupResult[] = [];
  for (const agentName of agents) {
    spinner.text = `Cleaning up ${getAgent(agentName).displayName}...`;
    results.push(await uninstallAgent(agentName, scope, modes));
  }

  spinner.succeed("Context7 cleanup complete");
  printResults(results, modes);

  trackEvent("uninstall", { agents, scope, modes });
}
