import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { Command } from "commander";

const mockGetValidAccessToken = vi.fn();
vi.mock("../utils/auth.js", () => ({
  getValidAccessToken: (...args: unknown[]) => mockGetValidAccessToken(...args),
}));

const mockAddGitHubRepository = vi.fn();
vi.mock("../utils/api.js", () => ({
  addGitHubRepository: (...args: unknown[]) => mockAddGitHubRepository(...args),
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

import {
  registerAddCommand,
  normalizeGitHubRepoUrl,
  exitCodeForAddFailure,
} from "../commands/add.js";

const TOKEN = "test-token";

beforeEach(() => {
  vi.clearAllMocks();
  mockGetValidAccessToken.mockResolvedValue(TOKEN);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  process.exitCode = undefined;
});

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

async function run(...args: string[]): Promise<void> {
  const program = new Command();
  program.exitOverride();
  registerAddCommand(program);
  await program.parseAsync(["node", "test", ...args]);
}

describe("normalizeGitHubRepoUrl", () => {
  test.each([
    ["vercel/next.js", "https://github.com/vercel/next.js"],
    ["https://github.com/vercel/next.js", "https://github.com/vercel/next.js"],
    ["https://github.com/vercel/next.js.git", "https://github.com/vercel/next.js"],
    ["http://github.com/vercel/next.js", "https://github.com/vercel/next.js"],
    ["git@github.com:vercel/next.js.git", "https://github.com/vercel/next.js"],
    ["github.com/vercel/next.js", "https://github.com/vercel/next.js"],
    ["https://github.com/vercel/next.js/tree/canary", "https://github.com/vercel/next.js"],
  ])("%s → %s", (input, expected) => {
    expect(normalizeGitHubRepoUrl(input)).toBe(expected);
  });

  test.each(["", "not-a-repo", "https://gitlab.com/a/b", "https://github.com/only-owner"])(
    "rejects %s",
    (input) => {
      expect(normalizeGitHubRepoUrl(input)).toBeNull();
    }
  );
});

describe("exitCodeForAddFailure", () => {
  test("maps auth, duplicate, and rate-limit statuses", () => {
    expect(exitCodeForAddFailure(401, "invalid_api_key")).toBe(2);
    expect(exitCodeForAddFailure(409, "duplicate_repo")).toBe(3);
    expect(exitCodeForAddFailure(429, "rate_limit_exceeded")).toBe(4);
    expect(exitCodeForAddFailure(500, "internal_error")).toBe(1);
  });
});

describe("ctx7 add", () => {
  test("submits a normalized repo URL with a refreshed token", async () => {
    mockAddGitHubRepository.mockResolvedValue({
      ok: true,
      status: 200,
      libraryName: "/vercel/next.js",
      message: "Repository submitted successfully",
    });

    await run("add", "vercel/next.js");

    expect(mockGetValidAccessToken).toHaveBeenCalled();
    expect(mockAddGitHubRepository).toHaveBeenCalledWith(
      { docsRepoUrl: "https://github.com/vercel/next.js" },
      TOKEN
    );
    expect(process.exitCode).toBe(0);
  });

  test("emits stable JSON on success", async () => {
    mockAddGitHubRepository.mockResolvedValue({
      ok: true,
      status: 200,
      libraryName: "/vercel/next.js",
      message: "Repository submitted successfully",
    });

    await run("add", "https://github.com/vercel/next.js", "--json");

    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('"libraryName": "/vercel/next.js"')
    );
    expect(process.exitCode).toBe(0);
  });

  test("rejects invalid repo input without calling the API", async () => {
    await run("add", "not-valid");

    expect(mockAddGitHubRepository).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  test("maps duplicate_repo to exit code 3", async () => {
    mockAddGitHubRepository.mockResolvedValue({
      ok: false,
      status: 409,
      error: "duplicate_repo",
      message: "This private repository is already in your team",
    });

    await run("add", "owner/repo", "--json");

    expect(process.exitCode).toBe(3);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('"error": "duplicate_repo"'));
  });

  test("maps unauthorized to exit code 2", async () => {
    mockGetValidAccessToken.mockResolvedValue(undefined);
    mockAddGitHubRepository.mockResolvedValue({
      ok: false,
      status: 401,
      error: "unauthorized",
      message: "Authentication required.",
    });

    await run("add", "owner/repo");

    expect(process.exitCode).toBe(2);
  });

  test("forwards private/git-token flags", async () => {
    mockAddGitHubRepository.mockResolvedValue({
      ok: true,
      status: 200,
      libraryName: "/owner/private-repo",
      message: "ok",
    });

    await run("add", "owner/private-repo", "--private", "--git-token", "ghp_test");

    expect(mockAddGitHubRepository).toHaveBeenCalledWith(
      {
        docsRepoUrl: "https://github.com/owner/private-repo",
        private: true,
        gitToken: "ghp_test",
      },
      TOKEN
    );
  });
});
