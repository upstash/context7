import { execSync, execFileSync, spawn, type ChildProcess } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  rmSync,
  unlinkSync,
  writeFileSync,
  copyFileSync,
  lstatSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { createConnection } from "node:net";
import { homedir } from "node:os";
import { MODE_CONFIGS, PROJECT_ROOT } from "./modes.js";

const BENCH_DIR = resolve(PROJECT_ROOT, "packages/benchmark");
export const EVAL_SET_PATH = resolve(BENCH_DIR, "trigger-eval.json");
export const SKILL_SOURCE = resolve(PROJECT_ROOT, "skills/find-docs/SKILL.md");
export const RESULTS_DIR = resolve(BENCH_DIR, "results");

const CLAUDE_DIR = resolve(homedir(), ".claude");
const CLAUDE_RULES_DIR = resolve(CLAUDE_DIR, "rules");
const SKILLS_DIR = resolve(CLAUDE_DIR, "skills");
const GLOBAL_MCP_CONFIG = resolve(CLAUDE_DIR, ".mcp.json");
const PROJECT_MCP_CONFIG = resolve(PROJECT_ROOT, ".mcp.json");
const RULE_FILE = resolve(CLAUDE_RULES_DIR, "context7.md");
const FIND_DOCS_SKILLS = [
  resolve(SKILLS_DIR, "find-docs/SKILL.md"),
  resolve(PROJECT_ROOT, ".claude/skills/find-docs/SKILL.md"),
  resolve(PROJECT_ROOT, ".agents/skills/find-docs/SKILL.md"),
];
const NIA_SKILL_REPO = "https://github.com/nozomio-labs/nia-skill.git";
const NIA_SKILL_CACHE = resolve(PROJECT_ROOT, "packages/benchmark/.nia-skill");
const NIA_SKILL_LOCATIONS = [
  resolve(SKILLS_DIR, "nia/SKILL.md"),
  resolve(PROJECT_ROOT, ".claude/skills/nia/SKILL.md"),
  resolve(PROJECT_ROOT, ".agents/skills/nia/SKILL.md"),
];
const ALL_SKILLS = [
  ...FIND_DOCS_SKILLS,
  ...NIA_SKILL_LOCATIONS,
  resolve(SKILLS_DIR, "context7-mcp/SKILL.md"),
  resolve(PROJECT_ROOT, ".claude/skills/context7-mcp/SKILL.md"),
  resolve(PROJECT_ROOT, ".agents/skills/context7-mcp/SKILL.md"),
];
const CLAUDE_MD = resolve(PROJECT_ROOT, "CLAUDE.md");

export const MCP_LOCAL_PORT = 4247;
const LOCAL_MCP_BUILD = resolve(PROJECT_ROOT, "packages/mcp/dist/index.js");

const MCP_SERVER_ENTRY = {
  mcpServers: {
    context7: {
      type: "http",
      url: `http://localhost:${MCP_LOCAL_PORT}/mcp`,
    },
  },
};
const MCP_EMPTY = { mcpServers: {} };

let mcpServerProcess: ChildProcess | null = null;

function waitForPort(port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;

    function attempt() {
      if (Date.now() > deadline) {
        resolve(false);
        return;
      }
      const conn = createConnection({ host: "localhost", port }, () => {
        conn.destroy();
        resolve(true);
      });
      conn.on("error", () => {
        setTimeout(attempt, 500);
      });
    }

    attempt();
  });
}

function waitForPortFree(port: number, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;

    function attempt() {
      if (Date.now() > deadline) {
        resolve();
        return;
      }
      const conn = createConnection({ host: "localhost", port }, () => {
        conn.destroy();
        setTimeout(attempt, 500);
      });
      conn.on("error", () => {
        resolve();
      });
    }

    attempt();
  });
}

async function startMcpServer(useLocal: boolean): Promise<void> {
  if (mcpServerProcess !== null) return;

  await waitForPortFree(MCP_LOCAL_PORT, 10_000);

  let cmd: string;
  let args: string[];
  if (useLocal) {
    cmd = "node";
    args = [LOCAL_MCP_BUILD, "--transport", "http", "--port", String(MCP_LOCAL_PORT)];
    console.log(`  Using LOCAL MCP build: ${LOCAL_MCP_BUILD}`);
  } else {
    cmd = "npx";
    args = [
      "-y",
      "@upstash/context7-mcp@latest",
      "--transport",
      "http",
      "--port",
      String(MCP_LOCAL_PORT),
    ];
  }

  mcpServerProcess = spawn(cmd, args, {
    stdio: ["ignore", "pipe", "pipe"],
  });

  const ready = await waitForPort(MCP_LOCAL_PORT, 15_000);
  if (!ready) {
    console.log("  WARNING: MCP server did not become ready in time");
    stopMcpServer();
    return;
  }

  if (mcpServerProcess.exitCode !== null) {
    console.log(`  WARNING: MCP server exited with code ${mcpServerProcess.exitCode}`);
    mcpServerProcess = null;
    return;
  }

  console.log(`  MCP server started on port ${MCP_LOCAL_PORT} (pid=${mcpServerProcess.pid})`);
}

function stopMcpServer(): void {
  if (mcpServerProcess !== null) {
    mcpServerProcess.kill("SIGKILL");
    mcpServerProcess = null;
    console.log("  MCP server stopped.");
  }
}

function ensureDir(dirPath: string): void {
  mkdirSync(dirPath, { recursive: true });
}

function safeUnlink(filePath: string): void {
  try {
    if (existsSync(filePath) || lstatSync(filePath).isSymbolicLink()) {
      unlinkSync(filePath);
    }
  } catch {}
}

function safeRmdir(dirPath: string): void {
  try {
    if (lstatSync(dirPath).isSymbolicLink()) {
      unlinkSync(dirPath);
    } else if (existsSync(dirPath)) {
      rmSync(dirPath, { recursive: false });
    }
  } catch {}
}

function runSilent(command: string): void {
  try {
    execSync(command, { stdio: "pipe" });
  } catch {}
}

function disableAll(): void {
  stopMcpServer();

  runSilent("pkill -9 -f context7-mcp");
  runSilent("pkill -9 -f @upstash/context7-mcp");
  runSilent("pkill -9 -f context7/packages/mcp");

  ensureDir(dirname(GLOBAL_MCP_CONFIG));
  writeFileSync(GLOBAL_MCP_CONFIG, JSON.stringify(MCP_EMPTY, null, 2));
  writeFileSync(PROJECT_MCP_CONFIG, JSON.stringify(MCP_EMPTY, null, 2));
  runSilent("claude mcp remove context7 --scope project");
  runSilent("claude mcp remove context7 --scope user");
  runSilent("claude mcp remove nia --scope project");
  runSilent("claude mcp remove nia --scope user");

  safeUnlink(RULE_FILE);

  for (const skillPath of ALL_SKILLS) {
    safeUnlink(skillPath);
    safeRmdir(dirname(skillPath));
  }

  safeUnlink(CLAUDE_MD);
}

async function enableMcp(useLocal: boolean): Promise<void> {
  await startMcpServer(useLocal);

  writeFileSync(GLOBAL_MCP_CONFIG, JSON.stringify(MCP_SERVER_ENTRY, null, 2));
  writeFileSync(PROJECT_MCP_CONFIG, JSON.stringify(MCP_SERVER_ENTRY, null, 2));

  runSilent("claude mcp remove context7 --scope project");

  try {
    execSync(
      `claude mcp add --scope project --transport http context7 http://localhost:${MCP_LOCAL_PORT}/mcp`,
      { stdio: "pipe" }
    );
  } catch (e) {
    console.log(`  WARNING: claude mcp add failed: ${e}`);
  }

  try {
    const check = execSync("claude mcp list", { encoding: "utf-8" });
    if (check.includes("context7")) {
      console.log("  MCP registered via claude mcp add");
    } else {
      console.log("  WARNING: MCP not found in claude mcp list");
    }
  } catch {
    console.log("  WARNING: could not verify MCP registration");
  }
}

function enableRule(content: string): void {
  ensureDir(CLAUDE_RULES_DIR);
  writeFileSync(RULE_FILE, `---\nalwaysApply: true\n---\n\n${content}`);
}

function enableSkill(opts?: { content?: string }): void {
  for (const skillPath of FIND_DOCS_SKILLS) {
    const parent = dirname(skillPath);
    try {
      if (lstatSync(parent).isSymbolicLink()) {
        unlinkSync(parent);
      }
    } catch {}
    ensureDir(parent);
    if (opts?.content) {
      writeFileSync(skillPath, opts.content);
    } else {
      copyFileSync(SKILL_SOURCE, skillPath);
    }
  }
}

function fetchNiaSkill(): void {
  if (existsSync(resolve(NIA_SKILL_CACHE, "SKILL.md"))) {
    execSync(`git -C "${NIA_SKILL_CACHE}" pull --quiet`, { stdio: "pipe" });
  } else {
    execSync(`git clone --depth 1 --quiet "${NIA_SKILL_REPO}" "${NIA_SKILL_CACHE}"`, {
      stdio: "pipe",
    });
  }
}

function enableNiaSkill(): void {
  fetchNiaSkill();
  const srcSkill = resolve(NIA_SKILL_CACHE, "SKILL.md");
  const srcScripts = resolve(NIA_SKILL_CACHE, "scripts");
  for (const skillPath of NIA_SKILL_LOCATIONS) {
    const parent = dirname(skillPath);
    try {
      if (lstatSync(parent).isSymbolicLink()) {
        unlinkSync(parent);
      }
    } catch {}
    ensureDir(parent);
    copyFileSync(srcSkill, skillPath);
    const destScripts = resolve(dirname(skillPath), "scripts");
    runSilent(`cp -r "${srcScripts}" "${destScripts}"`);
  }
}

function enableNia(apiKey: string): void {
  try {
    execFileSync(
      "claude",
      [
        "mcp",
        "add",
        "nia",
        "https://apigcp.trynia.ai/mcp",
        "--scope",
        "project",
        "--transport",
        "http",
        "--header",
        `Authorization: Bearer ${apiKey}`,
      ],
      { stdio: "pipe" }
    );
  } catch (e) {
    console.log(`  WARNING: claude mcp add nia failed: ${e}`);
  }

  try {
    const check = execSync("claude mcp list", { encoding: "utf-8" });
    if (check.includes("nia")) {
      console.log("  Nia MCP registered");
    } else {
      console.log("  WARNING: Nia not found in claude mcp list");
    }
  } catch {
    console.log("  WARNING: could not verify Nia registration");
  }
}

function enableClaudeMd(content: string): void {
  writeFileSync(CLAUDE_MD, `# Context7 Documentation Lookup\n\n${content}`);
}

export async function setupMode(mode: string): Promise<void> {
  const cfg = MODE_CONFIGS[mode];
  if (!cfg) {
    throw new Error(`Unknown mode: ${mode}. Available: ${Object.keys(MODE_CONFIGS).join(", ")}`);
  }

  disableAll();
  await new Promise((r) => setTimeout(r, 1000));

  if (cfg.mcp) {
    await enableMcp(cfg.useLocalMcp ?? false);
  }
  if (cfg.rule) {
    enableRule(cfg.ruleContent!);
  }
  if (cfg.skill) {
    enableSkill({ content: cfg.skillContent });
  }
  if (cfg.nia) {
    const niaKey = cfg.niaApiKey || process.env.NIA_API_KEY;
    if (!niaKey) {
      throw new Error("Nia mode requires NIA_API_KEY env var or niaApiKey in mode config");
    }
    enableNia(niaKey);
  }
  if (cfg.niaSkill) {
    enableNiaSkill();
  }
  if (cfg.claudeMd) {
    enableClaudeMd(cfg.claudeMdContent!);
  }

  console.log(`  Environment: ${cfg.description}`);
  console.log(
    `    MCP=${cfg.mcp}  Rule=${cfg.rule}  Skill=${cfg.skill}  CLAUDE.md=${cfg.claudeMd}  Detect=${cfg.detection}`
  );
}

export function teardown(): void {
  disableAll();
  enableSkill();
  console.log("  Environment cleaned up (skills restored).");
}
