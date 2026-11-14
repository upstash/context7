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
const mockGetUpgradeGuide = vi.fn();
vi.mock("../utils/api.js", async () => {
  const actual = await vi.importActual<typeof import("../utils/api.js")>("../utils/api.js");
  return {
    CODE_OPERATIONS: actual.CODE_OPERATIONS,
    CODE_LIMITS: actual.CODE_LIMITS,
    hasSourceCode: actual.hasSourceCode,
    resolveLibrary: (...args: unknown[]) => mockResolveLibrary(...args),
    getLibraryContext: (...args: unknown[]) => mockGetLibraryContext(...args),
    getLibraryCode: (...args: unknown[]) => mockGetLibraryCode(...args),
    getUpgradeGuide: (...args: unknown[]) => mockGetUpgradeGuide(...args),
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

describe("ctx7 library", () => {
  test("prints an empty successful response as JSON with --json", async () => {
    mockResolveLibrary.mockResolvedValue({ results: [] });

    await run(registerDocsCommands, "library", "react", "--json");

    const stdout = vi.mocked(console.log).mock.calls.flat().join("\n");
    expect(JSON.parse(stdout)).toEqual([]);
    expect(console.log).toHaveBeenCalledTimes(1);
    expect(console.error).not.toHaveBeenCalled();
    expect(process.exitCode).toBeUndefined();
  });
});

describe("ctx7 docs", () => {
  test("prints an empty successful response as JSON with --json", async () => {
    const response = { codeSnippets: [], infoSnippets: [] };
    mockGetLibraryContext.mockResolvedValue(response);

    await run(registerDocsCommands, "docs", "/a/b", "q", "--json");

    const stdout = vi.mocked(console.log).mock.calls.flat().join("\n");
    expect(JSON.parse(stdout)).toEqual(response);
    expect(console.log).toHaveBeenCalledTimes(1);
    expect(console.error).not.toHaveBeenCalled();
    expect(process.exitCode).toBeUndefined();
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
      kind: "pending",
      message: "Indexing.",
      retryAfter: 30,
    });

    await run(registerDocsCommands, "code", "/a/b", "x");

    expect(process.exitCode).toBe(75);
  });

  test("writes the indexing notice and errors to stderr when stdout is piped", async () => {
    mockGetLibraryCode
      .mockResolvedValueOnce({ kind: "pending", message: "Indexing.", retryAfter: 30 })
      .mockResolvedValueOnce({ kind: "error", error: "no_source", message: "No source." });

    await run(registerDocsCommands, "code", "/a/b", "x");
    await run(registerDocsCommands, "code", "/a/b", "x");

    const stderr = vi.mocked(console.error).mock.calls.flat().join("\n");
    expect(stderr).toContain("Indexing.");
    expect(stderr).toContain("Run the same command again");
    expect(stderr).toContain("No source.");
    expect(console.log).not.toHaveBeenCalled();
  });

  test("keeps the indexing notice on stdout in a terminal and JSON on stdout when piped", async () => {
    const wasTTY = process.stdout.isTTY;
    try {
      process.stdout.isTTY = true;
      mockGetLibraryCode.mockResolvedValue({
        kind: "pending",
        message: "Indexing.",
        retryAfter: 30,
      });
      await run(registerDocsCommands, "code", "/a/b", "x");
      expect(vi.mocked(console.log).mock.calls.flat().join("\n")).toContain("Indexing.");
      expect(console.error).not.toHaveBeenCalled();

      process.stdout.isTTY = false;
      vi.mocked(console.log).mockClear();
      await run(registerDocsCommands, "code", "/a/b", "x", "--json");
      expect(console.log).toHaveBeenCalledWith(
        JSON.stringify({ error: "indexing", message: "Indexing.", retryAfter: 30 })
      );
      expect(console.error).not.toHaveBeenCalled();
    } finally {
      process.stdout.isTTY = wasTTY;
    }
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

describe("ctx7 get-upgrade-guide", () => {
  test("passes the refreshed token, the versions and the page to the API", async () => {
    mockGetUpgradeGuide.mockResolvedValue({ kind: "result", body: "# Upgrade guide" });

    await run(registerDocsCommands, "get-upgrade-guide", "/a/b", "14", "16", "--page", "2");

    expect(mockGetUpgradeGuide).toHaveBeenCalledWith(
      "/a/b",
      "14",
      { toVersion: "16", page: 2, json: undefined },
      REFRESHED
    );
    expect(console.log).toHaveBeenCalledWith("# Upgrade guide");
    expect(process.exitCode).toBeUndefined();
  });

  test("leaves the target version and page to the API when they are not given", async () => {
    mockGetUpgradeGuide.mockResolvedValue({ kind: "result", body: "ok" });

    await run(registerDocsCommands, "get-upgrade-guide", "/a/b", "14.2.35");

    expect(mockGetUpgradeGuide).toHaveBeenCalledWith(
      "/a/b",
      "14.2.35",
      { toVersion: undefined, page: undefined, json: undefined },
      REFRESHED
    );
  });

  test("asks to run again while the guide is being prepared", async () => {
    mockGetUpgradeGuide.mockResolvedValue({
      kind: "pending",
      message: "Preparing.",
      retryAfter: 60,
    });

    await run(registerDocsCommands, "get-upgrade-guide", "/a/b", "14", "--json");

    expect(console.log).toHaveBeenCalledWith(
      JSON.stringify({ error: "preparing", message: "Preparing.", retryAfter: 60 })
    );
    expect(process.exitCode).toBe(75);
  });

  test("prints the API's message for a guide that is not available", async () => {
    mockGetUpgradeGuide.mockResolvedValue({
      kind: "error",
      error: "library_not_prepared",
      message: "Not prepared yet.",
    });

    await run(registerDocsCommands, "get-upgrade-guide", "/a/b", "14", "--json");

    expect(console.log).toHaveBeenCalledWith(
      JSON.stringify({ error: "library_not_prepared", message: "Not prepared yet." })
    );
    expect(process.exitCode).toBe(1);
  });

  test.each(["0", "1.5", "next"])("rejects --page %s without calling the API", async (page) => {
    await run(registerDocsCommands, "get-upgrade-guide", "/a/b", "14", "--page", page);

    expect(mockGetUpgradeGuide).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  test("rejects an invalid library ID without calling the API", async () => {
    await run(registerDocsCommands, "get-upgrade-guide", "react", "18");

    expect(mockGetUpgradeGuide).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  test("warns when the API returns an empty guide", async () => {
    mockGetUpgradeGuide.mockResolvedValue({ kind: "result", body: "" });

    await run(registerDocsCommands, "get-upgrade-guide", "/a/b", "14");

    expect(process.exitCode).toBe(1);
  });
});
