import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { mkdir, readFile, rm, stat } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { Command } from "commander";

const mockResolveSetupApiKey = vi.fn();
vi.mock("../setup/auth.js", () => ({
  resolveSetupApiKey: (...args: unknown[]) => mockResolveSetupApiKey(...args),
}));

vi.mock("../setup/templates.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../setup/templates.js")>();
  return {
    ...original,
    fetchSetupSkillFiles: async () => null,
    getRuleContent: async () => "rule\n",
  };
});

import { registerSetupCommand } from "../commands/setup.js";

let originalCwd: string;
let tempDir: string;

async function runSetup(...args: string[]): Promise<void> {
  const program = new Command();
  program.exitOverride();
  registerSetupCommand(program);
  await program.parseAsync(["node", "ctx7", "setup", "--codex", "--project", "--yes", ...args]);
}

beforeEach(async () => {
  process.exitCode = undefined;
  originalCwd = process.cwd();
  tempDir = join(tmpdir(), `ctx7-api-key-policy-${Date.now()}`);
  await mkdir(tempDir, { recursive: true });
  process.chdir(tempDir);
  vi.stubEnv("CTX7_TELEMETRY_DISABLED", "1");
  vi.stubEnv("CONTEXT7_API_KEY", "");
  vi.stubEnv("CONTEXT7_BASE_URL", "");
  mockResolveSetupApiKey.mockReset();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
  process.exitCode = undefined;
  process.chdir(originalCwd);
  await rm(tempDir, { recursive: true, force: true });
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("setup when the teamspace refuses API keys", () => {
  test.each(["api_keys_disabled", "api_key_admins_only"] as const)(
    "%s: continues the MCP setup with OAuth, without a prompt under --yes",
    async (refusal) => {
      mockResolveSetupApiKey.mockResolvedValue({ refusal });

      await runSetup("--mcp");

      const config = await readFile(join(tempDir, ".codex", "config.toml"), "utf-8");
      expect(config).toContain('url = "https://mcp.context7.com/mcp/oauth"');
      expect(config).not.toContain("CONTEXT7_API_KEY");
      expect(process.exitCode).toBeUndefined();
      const errors = vi.mocked(console.error).mock.calls.flat().join("\n");
      expect(errors).toContain("allows only OAuth");
    }
  );

  test("stops with a pointer to OAuth over HTTP when --stdio needs a key", async () => {
    mockResolveSetupApiKey.mockResolvedValue({ refusal: "api_keys_disabled" });

    await runSetup("--mcp", "--stdio");

    await expect(stat(join(tempDir, ".codex", "config.toml"))).rejects.toThrow();
    expect(process.exitCode).toBe(1);
    const errors = vi.mocked(console.error).mock.calls.flat().join("\n");
    expect(errors).toContain("npx ctx7@latest setup --mcp --oauth");
  });

  test("does not fall back to OAuth when key creation fails for another reason", async () => {
    mockResolveSetupApiKey.mockResolvedValue(null);

    await runSetup("--mcp");

    await expect(stat(join(tempDir, ".codex", "config.toml"))).rejects.toThrow();
  });
});
