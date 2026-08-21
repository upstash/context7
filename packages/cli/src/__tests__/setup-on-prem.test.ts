import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { mkdir, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { Command } from "commander";

const promptMocks = vi.hoisted(() => ({
  password: vi.fn(),
  select: vi.fn(),
}));

vi.mock("@inquirer/prompts", () => promptMocks);

import { registerSetupCommand } from "../commands/setup.js";

let originalCwd: string;
let tempDir: string;

beforeEach(async () => {
  originalCwd = process.cwd();
  tempDir = join(tmpdir(), `ctx7-on-prem-setup-${Date.now()}`);
  await mkdir(tempDir, { recursive: true });
  process.chdir(tempDir);
  vi.unstubAllEnvs();
  promptMocks.password.mockReset();
  promptMocks.select.mockReset();
  vi.stubEnv("CTX7_TELEMETRY_DISABLED", "");
  vi.stubEnv("CONTEXT7_API_KEY", "");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url === "https://context7.internal.example/api/auth/mcp") {
        return {
          ok: true,
          json: async () => ({ enabled: false }),
        } as Response;
      }
      throw new Error(`Unexpected outbound request: ${url}`);
    })
  );
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
  process.chdir(originalCwd);
  await rm(tempDir, { recursive: true, force: true });
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("on-premise setup network boundary", () => {
  test("only contacts the configured deployment and uses bundled assets", async () => {
    const program = new Command();
    program.exitOverride();
    registerSetupCommand(program);

    await program.parseAsync([
      "node",
      "ctx7",
      "setup",
      "--mcp",
      "--base-url",
      "https://context7.internal.example",
      "--codex",
      "--project",
      "--yes",
    ]);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      "https://context7.internal.example/api/auth/mcp",
      expect.objectContaining({ headers: { Accept: "application/json" } })
    );

    const config = await readFile(join(tempDir, ".codex", "config.toml"), "utf-8");
    expect(config).toContain('url = "https://context7.internal.example/mcp"');
    expect(config).not.toContain("Authorization");

    const skill = await readFile(
      join(tempDir, ".agents", "skills", "context7-mcp", "SKILL.md"),
      "utf-8"
    );
    expect(skill).toContain("name: context7-mcp");
    expect(skill).toContain("resolve-library-id");
    expect(await readFile(join(tempDir, "AGENTS.md"), "utf-8")).toContain("query-docs");
  });

  test("prompts securely for an on-premise key when MCP auth is enabled", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ enabled: true }),
    } as Response);
    promptMocks.password.mockResolvedValue("  ctx7op-preview_secret  ");

    const program = new Command();
    program.exitOverride();
    registerSetupCommand(program);

    await program.parseAsync([
      "node",
      "ctx7",
      "setup",
      "--mcp",
      "--base-url",
      "https://context7.internal.example",
      "--codex",
      "--project",
    ]);

    expect(promptMocks.password).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Personal API key (create one at https://context7.internal.example/account)",
        mask: true,
        validate: expect.any(Function),
      })
    );

    const config = await readFile(join(tempDir, ".codex", "config.toml"), "utf-8");
    expect(config).toContain('url = "https://context7.internal.example/mcp"');
    expect(config).toContain('Authorization = "Bearer ctx7op-preview_secret"');
  });

  test("does not prompt during non-interactive --yes setup", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ enabled: true }),
    } as Response);

    const program = new Command();
    program.exitOverride();
    registerSetupCommand(program);

    await program.parseAsync([
      "node",
      "ctx7",
      "setup",
      "--mcp",
      "--base-url",
      "https://context7.internal.example",
      "--codex",
      "--project",
      "--yes",
    ]);

    expect(promptMocks.password).not.toHaveBeenCalled();
    await expect(readFile(join(tempDir, ".codex", "config.toml"), "utf-8")).rejects.toThrow();
  });
});
