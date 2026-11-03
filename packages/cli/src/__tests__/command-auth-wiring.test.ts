import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { Command } from "commander";

// Every command that talks to the API must obtain its token from
// getValidAccessToken(), so an expired one refreshes instead of silently
// degrading to an anonymous request. Unit tests on the helper cannot catch a
// command that never calls it, which is how three commands drifted for months.
const mockGetValidAccessToken = vi.fn();
vi.mock("../utils/auth.js", () => ({
  getValidAccessToken: (...args: unknown[]) => mockGetValidAccessToken(...args),
}));

const mockResolveLibrary = vi.fn();
const mockGetLibraryContext = vi.fn();
const mockGetLibraryCode = vi.fn();
vi.mock("../utils/api.js", async () => {
  const actual = await vi.importActual<typeof import("../utils/api.js")>("../utils/api.js");
  return {
    CODE_OPERATIONS: actual.CODE_OPERATIONS,
    CODE_LIMITS: actual.CODE_LIMITS,
    hasSourceCode: actual.hasSourceCode,
    resolveLibrary: (...args: unknown[]) => mockResolveLibrary(...args),
    getLibraryContext: (...args: unknown[]) => mockGetLibraryContext(...args),
    getLibraryCode: (...args: unknown[]) => mockGetLibraryCode(...args),
    getBaseUrl: () => "https://test.context7.com",
  };
});

vi.mock("../utils/tracking.js", () => ({ trackEvent: vi.fn() }));

const mockSpinner = {
  start: vi.fn().mockReturnThis(),
  stop: vi.fn().mockReturnThis(),
  succeed: vi.fn().mockReturnThis(),
  fail: vi.fn().mockReturnThis(),
  warn: vi.fn().mockReturnThis(),
  text: "",
};
vi.mock("ora", () => ({ default: () => mockSpinner }));

import { registerDocsCommands } from "../commands/docs.js";

const REFRESHED = "refreshed-token";

beforeEach(() => {
  vi.clearAllMocks();
  mockGetValidAccessToken.mockResolvedValue(REFRESHED);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  process.exitCode = undefined;
});

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

async function run(register: (p: Command) => void, ...args: string[]): Promise<void> {
  // Like src/index.ts: the root program owns -v/--version.
  const program = new Command().version("0.0.0-test", "-v, --version");
  program.exitOverride();
  register(program);
  await program.parseAsync(["node", "test", ...args]);
}

describe("commands pass a refreshed token to the API", () => {
  test("ctx7 library", async () => {
    mockResolveLibrary.mockResolvedValue({ results: [{ id: "/a/b", title: "B" }] });

    await run(registerDocsCommands, "library", "react");

    expect(mockGetValidAccessToken).toHaveBeenCalled();
    expect(mockResolveLibrary).toHaveBeenCalledWith("react", undefined, REFRESHED);
  });

  test("ctx7 docs", async () => {
    mockGetLibraryContext.mockResolvedValue("docs body");

    await run(registerDocsCommands, "docs", "/a/b", "how does it work");

    expect(mockGetValidAccessToken).toHaveBeenCalled();
    expect(mockGetLibraryContext).toHaveBeenCalledWith(
      "/a/b",
      "how does it work",
      { type: "txt" },
      REFRESHED
    );
  });
});

describe("ctx7 code", () => {
  test("passes the refreshed token and ripgrep-style flags to the API", async () => {
    mockGetLibraryCode.mockResolvedValue({ kind: "result", body: "lib/a.ts:1:x" });

    await run(
      registerDocsCommands,
      "code",
      "/a/b",
      "use(Router|Params)",
      "-i",
      "-g",
      "*.ts",
      "-g",
      "!**/test/**",
      "-C",
      "2",
      "-c"
    );

    expect(mockGetLibraryCode).toHaveBeenCalledWith(
      "/a/b",
      "use(Router|Params)",
      expect.objectContaining({
        ignoreCase: true,
        glob: ["*.ts", "!**/test/**"],
        context: 2,
        outputMode: "count",
      }),
      REFRESHED
    );
    expect(console.log).toHaveBeenCalledWith("lib/a.ts:1:x");
    expect(process.exitCode).toBeUndefined();
  });

  test("takes the tag with --tag and the pattern after a repeated -g", async () => {
    mockGetLibraryCode.mockResolvedValue({ kind: "result", body: "ok" });

    await run(
      registerDocsCommands,
      "code",
      "/a/b",
      "-g",
      "*.ts",
      "-g",
      "!**/test/**",
      "Request failed",
      "--tag",
      "v2",
      "-F"
    );

    expect(mockGetLibraryCode).toHaveBeenCalledWith(
      "/a/b",
      "Request failed",
      expect.objectContaining({ version: "v2", glob: ["*.ts", "!**/test/**"], fixedStrings: true }),
      REFRESHED
    );
  });

  test("prints JSON for errors with --json", async () => {
    mockGetLibraryCode.mockResolvedValue({ kind: "error", error: "not_indexed", message: "No." });

    await run(registerDocsCommands, "code", "/a/b", "x", "--json");

    expect(console.log).toHaveBeenCalledWith(
      JSON.stringify({ error: "not_indexed", message: "No." })
    );
    expect(process.exitCode).toBe(1);
  });

  test("asks to retry while the source is being indexed", async () => {
    mockGetLibraryCode.mockResolvedValue({
      kind: "indexing",
      message: "Indexing.",
      retryAfter: 30,
    });

    await run(registerDocsCommands, "code", "/a/b", "x");

    expect(process.exitCode).toBe(75);
  });

  test("clamps out-of-range numbers like the MCP tool", async () => {
    mockGetLibraryCode.mockResolvedValue({ kind: "result", body: "ok" });

    await run(registerDocsCommands, "code", "/a/b", "x", "-C", "25", "--head-limit", "900");

    expect(mockGetLibraryCode).toHaveBeenCalledWith(
      "/a/b",
      "x",
      expect.objectContaining({ context: 10, headLimit: 500 }),
      REFRESHED
    );
  });

  test("rejects a flag that is not a number without calling the API", async () => {
    await run(registerDocsCommands, "code", "/a/b", "x", "--offset", "next");

    expect(mockGetLibraryCode).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  test("rejects an unknown operation without calling the API", async () => {
    await run(registerDocsCommands, "code", "/a/b", "x", "--op", "graph");

    expect(mockGetLibraryCode).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });
});

describe("commands stay anonymous when no token is available", () => {
  beforeEach(() => {
    mockGetValidAccessToken.mockResolvedValue(undefined);
  });

  test("ctx7 library sends no token", async () => {
    mockResolveLibrary.mockResolvedValue({ results: [] });

    await run(registerDocsCommands, "library", "react");

    expect(mockResolveLibrary).toHaveBeenCalledWith("react", undefined, undefined);
  });

  test("ctx7 docs sends no token", async () => {
    mockGetLibraryContext.mockResolvedValue("docs body");

    await run(registerDocsCommands, "docs", "/a/b", "q");

    expect(mockGetLibraryContext).toHaveBeenCalledWith("/a/b", "q", { type: "txt" }, undefined);
  });
});
