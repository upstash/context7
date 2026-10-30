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
vi.mock("../utils/api.js", () => ({
  resolveLibrary: (...args: unknown[]) => mockResolveLibrary(...args),
  getLibraryContext: (...args: unknown[]) => mockGetLibraryContext(...args),
  getLibraryCode: (...args: unknown[]) => mockGetLibraryCode(...args),
  CODE_OPERATIONS: ["grep", "definition", "references", "outline", "read", "list"],
  getBaseUrl: () => "https://test.context7.com",
}));

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
  const program = new Command();
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

  test("maps the first version's flags", async () => {
    mockGetLibraryCode.mockResolvedValue({ kind: "result", body: "ok" });

    await run(
      registerDocsCommands,
      "code",
      "/a/b",
      "Request failed",
      "--type",
      "text",
      "--limit",
      "5",
      "--version",
      "v2"
    );

    // --version is its own field, sent next to the library ID.
    expect(mockGetLibraryCode).toHaveBeenCalledWith(
      "/a/b",
      "Request failed",
      expect.objectContaining({
        version: "v2",
        operation: "grep",
        fixedStrings: true,
        headLimit: 5,
      }),
      REFRESHED
    );
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
