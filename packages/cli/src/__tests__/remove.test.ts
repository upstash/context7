import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { Command } from "commander";
import { mkdir, readFile, writeFile, rm, access } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

const trackEvent = vi.fn();

vi.mock("../utils/tracking.js", () => ({
  trackEvent: (...args: unknown[]) => trackEvent(...args),
}));

const mockSpinner = {
  start: vi.fn().mockReturnThis(),
  stop: vi.fn().mockReturnThis(),
  succeed: vi.fn().mockReturnThis(),
  fail: vi.fn().mockReturnThis(),
  text: "",
};
vi.mock("ora", () => ({ default: () => mockSpinner }));

import { registerRemoveCommand } from "../commands/remove.js";

let tempDir: string;
let originalCwd: string;

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function runCommand(...args: string[]): Promise<void> {
  const program = new Command();
  program.exitOverride();
  registerRemoveCommand(program);
  await program.parseAsync(["node", "test", ...args]);
}

beforeEach(async () => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  originalCwd = process.cwd();
  tempDir = join(tmpdir(), `ctx7-uninstall-${Date.now()}`);
  await mkdir(tempDir, { recursive: true });
  process.chdir(tempDir);
});

afterEach(async () => {
  process.chdir(originalCwd);
  await rm(tempDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("remove command", () => {
  test("removes only CLI artifacts for cursor project setup", async () => {
    const rulePath = join(tempDir, ".cursor", "rules", "context7.mdc");
    const cliSkillPath = join(tempDir, ".cursor", "skills", "find-docs", "SKILL.md");
    const mcpSkillPath = join(tempDir, ".cursor", "skills", "context7-mcp", "SKILL.md");

    await mkdir(join(tempDir, ".cursor", "rules"), { recursive: true });
    await mkdir(join(tempDir, ".cursor", "skills", "find-docs"), { recursive: true });
    await mkdir(join(tempDir, ".cursor", "skills", "context7-mcp"), { recursive: true });
    await writeFile(rulePath, "cursor rule", "utf-8");
    await writeFile(cliSkillPath, "find docs", "utf-8");
    await writeFile(mcpSkillPath, "mcp skill", "utf-8");

    await runCommand("remove", "--cursor", "--cli", "--project");

    expect(await exists(rulePath)).toBe(false);
    expect(await exists(join(tempDir, ".cursor", "skills", "find-docs"))).toBe(false);
    expect(await exists(mcpSkillPath)).toBe(true);
    expect(trackEvent).toHaveBeenCalledWith("command", { name: "remove" });
    expect(trackEvent).toHaveBeenCalledWith("remove", {
      agents: ["cursor"],
      scope: "project",
      modes: ["cli"],
    });
  });

  test("removes only MCP artifacts for codex project setup", async () => {
    const agentsPath = join(tempDir, "AGENTS.md");
    const tomlPath = join(tempDir, ".codex", "config.toml");
    const mcpSkillPath = join(tempDir, ".agents", "skills", "context7-mcp", "SKILL.md");
    const cliSkillPath = join(tempDir, ".agents", "skills", "find-docs", "SKILL.md");

    await mkdir(join(tempDir, ".codex"), { recursive: true });
    await mkdir(join(tempDir, ".agents", "skills", "context7-mcp"), { recursive: true });
    await mkdir(join(tempDir, ".agents", "skills", "find-docs"), { recursive: true });
    await writeFile(
      agentsPath,
      "# Before\n\n<!-- context7 -->\nrule body\n<!-- context7 -->\n",
      "utf-8"
    );
    await writeFile(
      tomlPath,
      'model = "gpt-5"\n\n[mcp_servers.context7]\nurl = "https://mcp.context7.com/mcp"\n\n[mcp_servers.other]\nurl = "https://other.com"\n',
      "utf-8"
    );
    await writeFile(mcpSkillPath, "mcp skill", "utf-8");
    await writeFile(cliSkillPath, "find docs", "utf-8");

    await runCommand("remove", "--codex", "--mcp", "--project");

    const agentsContent = await readFile(agentsPath, "utf-8");
    const tomlContent = await readFile(tomlPath, "utf-8");

    expect(agentsContent).not.toContain("<!-- context7 -->");
    expect(tomlContent).toContain("[mcp_servers.other]");
    expect(tomlContent).not.toContain("[mcp_servers.context7]");
    expect(await exists(join(tempDir, ".agents", "skills", "context7-mcp"))).toBe(false);
    expect(await exists(cliSkillPath)).toBe(true);
    expect(trackEvent).toHaveBeenCalledWith("remove", {
      agents: ["codex"],
      scope: "project",
      modes: ["mcp"],
    });
  });

  test("supports uninstall alias and --all to remove both setup modes", async () => {
    const agentsPath = join(tempDir, "AGENTS.md");
    const tomlPath = join(tempDir, ".codex", "config.toml");
    const mcpSkillPath = join(tempDir, ".agents", "skills", "context7-mcp", "SKILL.md");
    const cliSkillPath = join(tempDir, ".agents", "skills", "find-docs", "SKILL.md");

    await mkdir(join(tempDir, ".codex"), { recursive: true });
    await mkdir(join(tempDir, ".agents", "skills", "context7-mcp"), { recursive: true });
    await mkdir(join(tempDir, ".agents", "skills", "find-docs"), { recursive: true });
    await writeFile(
      agentsPath,
      "# Before\n\n<!-- context7 -->\nrule body\n<!-- context7 -->\n",
      "utf-8"
    );
    await writeFile(
      tomlPath,
      '[mcp_servers.context7]\nurl = "https://mcp.context7.com/mcp"\n',
      "utf-8"
    );
    await writeFile(mcpSkillPath, "mcp skill", "utf-8");
    await writeFile(cliSkillPath, "find docs", "utf-8");

    await runCommand("uninstall", "--codex", "--all", "--project");

    const agentsContent = await readFile(agentsPath, "utf-8");
    expect(agentsContent).not.toContain("<!-- context7 -->");
    expect(await exists(join(tempDir, ".agents", "skills", "context7-mcp"))).toBe(false);
    expect(await exists(join(tempDir, ".agents", "skills", "find-docs"))).toBe(false);
    expect(await readFile(tomlPath, "utf-8")).not.toContain("[mcp_servers.context7]");
    expect(trackEvent).toHaveBeenCalledWith("remove", {
      agents: ["codex"],
      scope: "project",
      modes: ["mcp", "cli"],
    });
  });
});
