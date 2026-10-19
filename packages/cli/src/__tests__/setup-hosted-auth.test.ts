import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { mkdir, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { Command } from "commander";

const authMocks = vi.hoisted(() => ({
  performLogin: vi.fn(),
}));

vi.mock("../commands/auth.js", () => ({
  performLogin: (...args: unknown[]) => authMocks.performLogin(...args),
}));

import { registerSetupCommand } from "../commands/setup.js";
import { saveTokens } from "../utils/auth.js";

let originalCwd: string;
let tempDir: string;
let configHome: string;

function credentialsPath(): string {
  return join(configHome, "context7", "credentials.json");
}

async function runSetup(...args: string[]): Promise<void> {
  const program = new Command();
  program.exitOverride();
  registerSetupCommand(program);
  await program.parseAsync(["node", "ctx7", "setup", ...args]);
}

async function readMcpConfig(): Promise<{
  mcpServers: { context7: { headers?: { Authorization?: string }; url: string } };
}> {
  return JSON.parse(await readFile(join(tempDir, ".mcp.json"), "utf-8"));
}

beforeEach(async () => {
  process.exitCode = undefined;
  originalCwd = process.cwd();
  tempDir = join(
    tmpdir(),
    `ctx7-hosted-setup-${Date.now()}-${Math.random().toString(16).slice(2)}`
  );
  configHome = join(tempDir, "config");
  await mkdir(tempDir, { recursive: true });
  process.chdir(tempDir);
  vi.unstubAllEnvs();
  authMocks.performLogin.mockReset();
  authMocks.performLogin.mockResolvedValue(null);
  vi.stubEnv("HOME", tempDir);
  vi.stubEnv("XDG_CONFIG_HOME", configHome);
  vi.stubEnv("XDG_STATE_HOME", join(tempDir, "state"));
  vi.stubEnv("XDG_CACHE_HOME", join(tempDir, "cache"));
  vi.stubEnv("CONTEXT7_API_KEY", "");
  vi.stubEnv("CTX7_TELEMETRY_DISABLED", "1");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: false }) as Response)
  );
  vi.spyOn(console, "log").mockImplementation(() => {});
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

describe("hosted MCP setup authentication", () => {
  test("uses --api-key and does not start login", async () => {
    await runSetup("--mcp", "--claude", "--project", "--yes", "--api-key", "ctx7sk-from-flag");

    expect(authMocks.performLogin).not.toHaveBeenCalled();
    expect(await readMcpConfig()).toEqual({
      mcpServers: {
        context7: {
          type: "http",
          url: "https://mcp.context7.com/mcp",
          headers: { Authorization: "Bearer ctx7sk-from-flag" },
        },
      },
    });
    await expect(readFile(credentialsPath(), "utf-8")).rejects.toThrow();
  });

  test("uses CONTEXT7_API_KEY and does not start login", async () => {
    vi.stubEnv("CONTEXT7_API_KEY", "  ctx7sk-from-env  ");

    await runSetup("--mcp", "--claude", "--project", "--yes");

    expect(authMocks.performLogin).not.toHaveBeenCalled();
    expect((await readMcpConfig()).mcpServers.context7.headers?.Authorization).toBe(
      "Bearer ctx7sk-from-env"
    );
  });

  test("prefers --api-key over CONTEXT7_API_KEY", async () => {
    vi.stubEnv("CONTEXT7_API_KEY", "ctx7sk-from-env");

    await runSetup("--mcp", "--claude", "--project", "--yes", "--api-key", "ctx7sk-from-flag");

    expect(authMocks.performLogin).not.toHaveBeenCalled();
    expect((await readMcpConfig()).mcpServers.context7.headers?.Authorization).toBe(
      "Bearer ctx7sk-from-flag"
    );
  });

  test("keeps --oauth when CONTEXT7_API_KEY is set", async () => {
    vi.stubEnv("CONTEXT7_API_KEY", "ctx7sk-from-env");

    await runSetup("--mcp", "--claude", "--project", "--yes", "--oauth");

    expect(authMocks.performLogin).not.toHaveBeenCalled();
    expect(await readMcpConfig()).toEqual({
      mcpServers: {
        context7: {
          type: "http",
          url: "https://mcp.context7.com/mcp/oauth",
        },
      },
    });
  });

  test("starts login when neither --api-key nor CONTEXT7_API_KEY is set", async () => {
    vi.stubEnv("CONTEXT7_API_KEY", "   ");

    await runSetup("--mcp", "--claude", "--project", "--yes");

    expect(authMocks.performLogin).toHaveBeenCalledOnce();
    await expect(readFile(join(tempDir, ".mcp.json"), "utf-8")).rejects.toThrow();
  });
});

describe("CLI setup authentication", () => {
  test("uses --api-key and does not start login", async () => {
    await runSetup("--cli", "--claude", "--project", "--yes", "--api-key", "  ctx7sk-from-flag  ");

    expect(authMocks.performLogin).not.toHaveBeenCalled();
    expect(JSON.parse(await readFile(credentialsPath(), "utf-8"))).toMatchObject({
      access_token: "ctx7sk-from-flag",
      token_type: "bearer",
    });
    expect(
      await readFile(join(tempDir, ".claude", "skills", "find-docs", "SKILL.md"), "utf-8")
    ).toContain("name: find-docs");
  });

  test("uses CONTEXT7_API_KEY without saving it or starting login", async () => {
    vi.stubEnv("CONTEXT7_API_KEY", "  ctx7sk-from-env  ");

    await runSetup("--cli", "--claude", "--project", "--yes");

    expect(authMocks.performLogin).not.toHaveBeenCalled();
    await expect(readFile(credentialsPath(), "utf-8")).rejects.toThrow();
    await expect(
      readFile(join(tempDir, ".context7", "credentials.json"), "utf-8")
    ).rejects.toThrow();
    expect(
      await readFile(join(tempDir, ".claude", "skills", "find-docs", "SKILL.md"), "utf-8")
    ).toContain("name: find-docs");
  });

  test("prefers --api-key over CONTEXT7_API_KEY", async () => {
    vi.stubEnv("CONTEXT7_API_KEY", "ctx7sk-from-env");

    await runSetup("--cli", "--claude", "--project", "--yes", "--api-key", "ctx7sk-from-flag");

    expect(authMocks.performLogin).not.toHaveBeenCalled();
    expect(JSON.parse(await readFile(credentialsPath(), "utf-8")).access_token).toBe(
      "ctx7sk-from-flag"
    );
  });

  test("uses a saved session when no key is provided", async () => {
    saveTokens({ access_token: "ctx7sk-saved", token_type: "bearer" });

    await runSetup("--cli", "--claude", "--project", "--yes");

    expect(authMocks.performLogin).not.toHaveBeenCalled();
    expect(
      await readFile(join(tempDir, ".claude", "skills", "find-docs", "SKILL.md"), "utf-8")
    ).toContain("name: find-docs");
  });

  test("starts login when neither --api-key nor CONTEXT7_API_KEY is set", async () => {
    await runSetup("--cli", "--claude", "--project", "--yes");

    expect(authMocks.performLogin).toHaveBeenCalledOnce();
  });
});
