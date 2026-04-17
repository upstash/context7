import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { Command } from "commander";
import { mkdir, readFile, writeFile, rm, access } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

const trackEvent = vi.fn();
const mockCheckboxWithHover = vi.fn();
let logOutput: string[];

vi.mock("../utils/tracking.js", () => ({
  trackEvent: (...args: unknown[]) => trackEvent(...args),
}));

vi.mock("../utils/prompts.js", () => ({
  checkboxWithHover: (...args: unknown[]) => mockCheckboxWithHover(...args),
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
  logOutput = [];
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    logOutput.push(args.join(" "));
  });
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

  test("skips mode prompt when only one setup mode exists", async () => {
    const rulePath = join(tempDir, ".cursor", "rules", "context7.mdc");
    const cliSkillPath = join(tempDir, ".cursor", "skills", "find-docs", "SKILL.md");
    const mcpSkillPath = join(tempDir, ".cursor", "skills", "context7-mcp", "SKILL.md");

    await mkdir(join(tempDir, ".cursor", "rules"), { recursive: true });
    await mkdir(join(tempDir, ".cursor", "skills", "find-docs"), { recursive: true });
    await mkdir(join(tempDir, ".cursor", "skills", "context7-mcp"), { recursive: true });
    await writeFile(rulePath, "cursor rule", "utf-8");
    await writeFile(cliSkillPath, "find docs", "utf-8");
    await writeFile(mcpSkillPath, "mcp skill", "utf-8");

    await rm(join(tempDir, ".cursor", "skills", "context7-mcp"), { recursive: true });

    await runCommand("remove", "--cursor", "--project");

    expect(mockCheckboxWithHover).not.toHaveBeenCalled();
    expect(await exists(rulePath)).toBe(false);
    expect(await exists(join(tempDir, ".cursor", "skills", "find-docs"))).toBe(false);
    expect(await exists(mcpSkillPath)).toBe(false);
    expect(trackEvent).toHaveBeenCalledWith("remove", {
      agents: ["cursor"],
      scope: "project",
      modes: ["cli"],
    });
  });

  test("prompts for setup mode when both MCP and CLI artifacts exist", async () => {
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
    mockCheckboxWithHover.mockResolvedValueOnce(["cli"]);

    await runCommand("remove", "--codex", "--project");

    expect(mockCheckboxWithHover).toHaveBeenCalledTimes(1);
    expect(mockCheckboxWithHover.mock.calls[0]?.[0]).toMatchObject({
      message: "Which Context7 setup modes do you want to remove?",
    });
    expect(await exists(join(tempDir, ".agents", "skills", "find-docs"))).toBe(false);
    expect(await exists(mcpSkillPath)).toBe(true);
    expect(await readFile(tomlPath, "utf-8")).toContain("[mcp_servers.context7]");
    expect(trackEvent).toHaveBeenCalledWith("remove", {
      agents: ["codex"],
      scope: "project",
      modes: ["cli"],
    });
  });

  test("does not log not found items when other artifacts were removed", async () => {
    const agentsPath = join(tempDir, "AGENTS.md");
    const tomlPath = join(tempDir, ".codex", "config.toml");
    const mcpSkillPath = join(tempDir, ".agents", "skills", "context7-mcp", "SKILL.md");

    await mkdir(join(tempDir, ".codex"), { recursive: true });
    await mkdir(join(tempDir, ".agents", "skills", "context7-mcp"), { recursive: true });
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

    await runCommand("remove", "--codex", "--all", "--project");

    expect(logOutput.some((line) => line.includes("MCP config removed"))).toBe(true);
    expect(logOutput.some((line) => line.includes("Rule removed"))).toBe(true);
    expect(logOutput.some((line) => line.includes("Skill context7-mcp removed"))).toBe(true);
    expect(logOutput.some((line) => line.includes("not found"))).toBe(false);
  });

  test("removes only context7 from cursor JSON MCP config", async () => {
    const mcpPath = join(tempDir, ".cursor", "mcp.json");

    await mkdir(join(tempDir, ".cursor"), { recursive: true });
    await writeFile(
      mcpPath,
      JSON.stringify(
        {
          theme: "dark",
          mcpServers: {
            alpha: { url: "https://alpha.com" },
            context7: { url: "https://mcp.context7.com/mcp" },
            omega: { url: "https://omega.com" },
          },
          telemetry: { enabled: true },
        },
        null,
        2
      ),
      "utf-8"
    );

    await runCommand("remove", "--cursor", "--mcp", "--project");

    expect(JSON.parse(await readFile(mcpPath, "utf-8"))).toEqual({
      theme: "dark",
      mcpServers: {
        alpha: { url: "https://alpha.com" },
        omega: { url: "https://omega.com" },
      },
      telemetry: { enabled: true },
    });
  });

  test("removes only context7 from opencode JSONC MCP config", async () => {
    const configPath = join(tempDir, "opencode.jsonc");

    await writeFile(
      configPath,
      `{
  // keep this file functional after removing Context7
  "theme": "night",
  "mcp": {
    "alpha": { "type": "remote", "url": "https://alpha.com", "enabled": true },
    "context7": { "type": "remote", "url": "https://mcp.context7.com/mcp", "enabled": true },
    "omega": { "type": "remote", "url": "https://omega.com", "enabled": false }
  },
  "telemetry": { "enabled": true }
}
`,
      "utf-8"
    );

    await runCommand("remove", "--opencode", "--mcp", "--project");

    expect(JSON.parse(await readFile(configPath, "utf-8"))).toEqual({
      theme: "night",
      mcp: {
        alpha: { type: "remote", url: "https://alpha.com", enabled: true },
        omega: { type: "remote", url: "https://omega.com", enabled: false },
      },
      telemetry: { enabled: true },
    });
  });

  test("detects only agents with Context7 artifacts, not just agent folders", async () => {
    const rulePath = join(tempDir, ".cursor", "rules", "context7.mdc");
    const cliSkillPath = join(tempDir, ".cursor", "skills", "find-docs", "SKILL.md");

    await mkdir(join(tempDir, ".cursor", "rules"), { recursive: true });
    await mkdir(join(tempDir, ".cursor", "skills", "find-docs"), { recursive: true });
    await mkdir(join(tempDir, ".gemini"), { recursive: true });
    await writeFile(rulePath, "cursor rule", "utf-8");
    await writeFile(cliSkillPath, "find docs", "utf-8");
    mockCheckboxWithHover.mockResolvedValueOnce(["cursor"]);

    await runCommand("remove", "--project");

    expect(logOutput.some((line) => line.includes("Detected: Cursor"))).toBe(true);
    expect(logOutput.some((line) => line.includes("Gemini CLI"))).toBe(false);
    expect(mockCheckboxWithHover.mock.calls[0]?.[0]).toMatchObject({
      message: "Which agents do you want to remove Context7 setup from?",
      choices: [{ name: "Cursor", value: "cursor" }],
    });
  });

  test("does not prompt when no Context7 setup is detected", async () => {
    await mkdir(join(tempDir, ".gemini"), { recursive: true });
    await writeFile(join(tempDir, ".gemini", "settings.json"), "{}", "utf-8");

    await runCommand("remove", "--project");

    expect(mockCheckboxWithHover).not.toHaveBeenCalled();
    expect(logOutput.some((line) => line.includes("No Context7 setup detected"))).toBe(true);
  });
});
