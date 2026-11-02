import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { mkdir, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { Command } from "commander";
import { DEFAULT_CONTEXT7_BASE_URL, setBaseUrl } from "../utils/api.js";
import { readJsonConfig } from "../setup/mcp-writer.js";

const BASE_URL = "https://context7.internal.example";
const execFileMock = vi.hoisted(() => vi.fn());

vi.mock("child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("child_process")>()),
  execFile: execFileMock,
}));
vi.mock("@inquirer/prompts", () => ({ password: vi.fn(), select: vi.fn() }));

import { registerSetupCommand } from "../commands/setup.js";

let originalCwd: string;
let tempDir: string;
let configPath: string;

/** Makes `opencode --version` print `version`, or fail when it is undefined. */
function mockOpenCodeVersion(version: string | undefined): void {
  execFileMock.mockImplementation((_file, _args, _options, callback) => {
    if (version === undefined) callback(new Error("spawn opencode ENOENT"), "", "");
    else callback(null, `${version}\n`, "");
  });
}

async function runSetup(): Promise<void> {
  const program = new Command();
  program.exitOverride();
  registerSetupCommand(program);
  await program.parseAsync([
    "node",
    "ctx7",
    "setup",
    "--mcp",
    "--base-url",
    BASE_URL,
    "--opencode",
    "--project",
    "--yes",
  ]);
}

beforeEach(async () => {
  process.exitCode = undefined;
  originalCwd = process.cwd();
  tempDir = join(tmpdir(), `ctx7-opencode-setup-${Date.now()}`);
  await mkdir(tempDir, { recursive: true });
  process.chdir(tempDir);
  configPath = join(tempDir, "opencode.json");
  execFileMock.mockReset();
  vi.stubEnv("CTX7_TELEMETRY_DISABLED", "");
  vi.stubEnv("CONTEXT7_API_KEY", "");
  setBaseUrl(BASE_URL);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url === `${BASE_URL}/api/auth/mcp`) {
        return { ok: true, json: async () => ({ enabled: false }) } as Response;
      }
      throw new Error(`Unexpected outbound request: ${url}`);
    })
  );
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
  process.exitCode = undefined;
  process.chdir(originalCwd);
  setBaseUrl(DEFAULT_CONTEXT7_BASE_URL);
  await rm(tempDir, { recursive: true, force: true });
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const firecrawl = { type: "remote", url: "https://mcp.firecrawl.dev/v2/mcp-oauth" };
const v2Entry = { type: "remote", url: `${BASE_URL}/mcp` };

describe("ctx7 setup --opencode", () => {
  test("nests the server inside an existing 2.x mcp.servers map", async () => {
    await writeFile(configPath, JSON.stringify({ mcp: { servers: { firecrawl } } }));

    await runSetup();

    expect(await readJsonConfig(configPath)).toEqual({
      mcp: { servers: { firecrawl, context7: v2Entry } },
    });
    expect(execFileMock).not.toHaveBeenCalled();
  });

  test("repairs an entry that an earlier version wrote beside mcp.servers", async () => {
    await writeFile(
      configPath,
      JSON.stringify({
        mcp: { servers: { firecrawl }, context7: { ...v2Entry, enabled: true } },
      })
    );

    await runSetup();

    expect(await readJsonConfig(configPath)).toEqual({
      mcp: { servers: { firecrawl, context7: v2Entry } },
    });
  });

  test("keeps the 1.x shape for a 1.x config", async () => {
    await writeFile(configPath, JSON.stringify({ mcp: { firecrawl } }));

    await runSetup();

    expect(await readJsonConfig(configPath)).toEqual({
      mcp: { firecrawl, context7: { ...v2Entry, enabled: true } },
    });
  });

  test("uses the 2.x shape for a new config when OpenCode 2.x is installed", async () => {
    mockOpenCodeVersion("2.1.0");

    await runSetup();

    expect(await readJsonConfig(configPath)).toEqual({ mcp: { servers: { context7: v2Entry } } });
    expect(execFileMock).toHaveBeenCalledWith(
      "opencode",
      ["--version"],
      expect.objectContaining({ timeout: 3000 }),
      expect.any(Function)
    );
  });

  test("uses the 1.x shape for a new config when OpenCode is not found", async () => {
    mockOpenCodeVersion(undefined);

    await runSetup();

    expect(await readJsonConfig(configPath)).toEqual({
      mcp: { context7: { ...v2Entry, enabled: true } },
    });
  });
});
