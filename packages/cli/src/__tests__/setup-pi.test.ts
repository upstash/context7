import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { Command } from "commander";
import { access, mkdir, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { readJsonConfig } from "../setup/mcp-writer.js";

vi.mock("../utils/tracking.js", () => ({ trackEvent: vi.fn() }));
vi.mock("ora", () => ({
  default: () => ({
    start: vi.fn().mockReturnThis(),
    stop: vi.fn().mockReturnThis(),
    succeed: vi.fn().mockReturnThis(),
    warn: vi.fn().mockReturnThis(),
    fail: vi.fn().mockReturnThis(),
    text: "",
  }),
}));

import { registerSetupCommand } from "../commands/setup.js";
import { registerRemoveCommand } from "../commands/remove.js";
import { getAgent, resolvePiAgentDir, type AuthOptions } from "../setup/agents.js";

let originalCwd: string;
let tempDir: string;
let homeDir: string;
let logOutput: string[];

async function run(...args: string[]): Promise<void> {
  const program = new Command();
  program.exitOverride();
  registerSetupCommand(program);
  registerRemoveCommand(program);
  await program.parseAsync(["node", "ctx7", ...args]);
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

beforeEach(async () => {
  process.exitCode = undefined;
  originalCwd = process.cwd();
  tempDir = join(tmpdir(), `ctx7-pi-setup-${Date.now()}`);
  homeDir = join(tempDir, "home");
  await mkdir(join(tempDir, "project"), { recursive: true });
  process.chdir(join(tempDir, "project"));
  // Keep global writes (for example ~/.agents/skills) inside the temp directory.
  vi.stubEnv("HOME", homeDir);
  vi.stubEnv("USERPROFILE", homeDir);
  vi.stubEnv("PI_CODING_AGENT_DIR", "");
  // Rule and skill downloads fail, so setup uses the bundled copies.
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: false }) as Response)
  );
  logOutput = [];
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    logOutput.push(args.join(" "));
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
  process.exitCode = undefined;
  process.chdir(originalCwd);
  await rm(tempDir, { recursive: true, force: true });
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("pi agent config", () => {
  const agent = getAgent("pi");
  const apiKeyAuth: AuthOptions = { mode: "api-key", apiKey: "sk-test-123" };
  const oauthAuth: AuthOptions = { mode: "oauth" };

  test("HTTP entries use url, an optional bearer header, and direct exposure", () => {
    expect(agent.mcp.buildEntry(apiKeyAuth, "http", "https://mcp.context7.com/mcp")).toEqual({
      url: "https://mcp.context7.com/mcp",
      headers: { Authorization: "Bearer sk-test-123" },
      exposure: "direct",
    });
    expect(agent.mcp.buildEntry(oauthAuth, "http", "https://mcp.context7.com/mcp/oauth")).toEqual({
      url: "https://mcp.context7.com/mcp/oauth",
      exposure: "direct",
    });
  });

  test("stdio entries use npx and direct exposure", () => {
    expect(agent.mcp.buildEntry(apiKeyAuth, "stdio", "")).toEqual({
      command: "npx",
      args: ["-y", "@upstash/context7-mcp", "--api-key", "sk-test-123"],
      exposure: "direct",
    });
  });

  test.each([
    [{}, "/home/test/.pi/agent"],
    [{ PI_CODING_AGENT_DIR: "" }, "/home/test/.pi/agent"],
    [{ PI_CODING_AGENT_DIR: "/opt/pi" }, "/opt/pi"],
    [{ PI_CODING_AGENT_DIR: "~" }, "/home/test"],
    [{ PI_CODING_AGENT_DIR: "~/pi-config" }, "/home/test/pi-config"],
  ] as const)("resolves the agent directory for %o", (env, expected) => {
    expect(resolvePiAgentDir("linux", "/home/test", env)).toBe(expected);
  });
});

describe("ctx7 setup --pi", () => {
  test("writes project MCP config, AGENTS.md rule, and skill, then prints the sign-in step", async () => {
    const projectDir = process.cwd();
    const mcpPath = join(projectDir, ".pi", "mcp.json");
    await mkdir(join(projectDir, ".pi"), { recursive: true });
    const other = { command: "npx", args: ["-y", "other-mcp"] };
    await writeFile(mcpPath, JSON.stringify({ mcpServers: { other } }));

    await run("setup", "--pi", "--mcp", "--oauth", "--project", "--yes");

    expect(await readJsonConfig(mcpPath)).toEqual({
      mcpServers: {
        other,
        context7: { url: "https://mcp.context7.com/mcp/oauth", exposure: "direct" },
      },
    });
    expect(await readFile(join(projectDir, "AGENTS.md"), "utf-8")).toContain("<!-- context7 -->");
    expect(await exists(join(projectDir, ".agents", "skills", "context7-mcp", "SKILL.md"))).toBe(
      true
    );
    expect(logOutput.join("\n")).toContain("pi mcp login context7");
  });

  test("writes global config to PI_CODING_AGENT_DIR without a sign-in step for API keys", async () => {
    const agentDir = join(tempDir, "pi-agent");
    vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);

    await run("setup", "--pi", "--mcp", "--api-key", "ctx7sk-test", "--yes");

    expect(await readJsonConfig(join(agentDir, "mcp.json"))).toEqual({
      mcpServers: {
        context7: {
          url: "https://mcp.context7.com/mcp",
          headers: { Authorization: "Bearer ctx7sk-test" },
          exposure: "direct",
        },
      },
    });
    expect(await readFile(join(agentDir, "AGENTS.md"), "utf-8")).toContain("<!-- context7 -->");
    expect(await exists(join(homeDir, ".agents", "skills", "context7-mcp", "SKILL.md"))).toBe(true);
    expect(logOutput.join("\n")).not.toContain("pi mcp login");
  });

  test("adds the rule to an existing CLAUDE.md so a new AGENTS.md does not hide it", async () => {
    const projectDir = process.cwd();
    const claudeMd = join(projectDir, "CLAUDE.md");
    await writeFile(claudeMd, "# Claude rules\n");

    await run("setup", "--pi", "--mcp", "--oauth", "--project", "--yes");

    expect(await exists(join(projectDir, "AGENTS.md"))).toBe(false);
    const content = await readFile(claudeMd, "utf-8");
    expect(content.startsWith("# Claude rules\n")).toBe(true);
    expect(content).toContain("<!-- context7 -->");

    await run("remove", "--pi", "--project", "--yes");

    expect(await readFile(claudeMd, "utf-8")).toBe("# Claude rules\n");
  });

  test("prefers AGENTS.override.md, which pi reads before AGENTS.md", async () => {
    const projectDir = process.cwd();
    await writeFile(join(projectDir, "AGENTS.md"), "# Shared\n");
    await writeFile(join(projectDir, "AGENTS.override.md"), "# Override\n");

    await run("setup", "--pi", "--mcp", "--oauth", "--project", "--yes");

    expect(await readFile(join(projectDir, "AGENTS.md"), "utf-8")).toBe("# Shared\n");
    expect(await readFile(join(projectDir, "AGENTS.override.md"), "utf-8")).toContain(
      "<!-- context7 -->"
    );
  });

  test("ctx7 remove --pi undoes a project setup", async () => {
    const projectDir = process.cwd();
    await writeFile(join(projectDir, "AGENTS.md"), "# Project rules\n");
    await run("setup", "--pi", "--mcp", "--oauth", "--project", "--yes");

    await run("remove", "--pi", "--project", "--yes");

    expect(await readJsonConfig(join(projectDir, ".pi", "mcp.json"))).toEqual({});
    expect(await readFile(join(projectDir, "AGENTS.md"), "utf-8")).toBe("# Project rules\n");
    expect(await exists(join(projectDir, ".agents", "skills", "context7-mcp"))).toBe(false);
  });
});
