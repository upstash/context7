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
const mockSuggestSkills = vi.fn();
vi.mock("../utils/api.js", () => ({
  resolveLibrary: (...args: unknown[]) => mockResolveLibrary(...args),
  getLibraryContext: (...args: unknown[]) => mockGetLibraryContext(...args),
  suggestSkills: (...args: unknown[]) => mockSuggestSkills(...args),
  getBaseUrl: () => "https://test.context7.com",
  listProjectSkills: vi.fn(),
  searchSkills: vi.fn(),
  downloadSkill: vi.fn(),
  getSkill: vi.fn(),
  getSkillQuota: vi.fn(),
  getSkillQuestions: vi.fn(),
  generateSkillStructured: vi.fn(),
  searchLibraries: vi.fn(),
}));

vi.mock("../utils/tracking.js", () => ({ trackEvent: vi.fn() }));

vi.mock("../utils/deps.js", () => ({
  detectProjectDependencies: () => ["react"],
}));

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
import { registerSkillCommands } from "../commands/skill.js";

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

  test("ctx7 skills suggest", async () => {
    mockSuggestSkills.mockResolvedValue({ skills: [] });

    await run(registerSkillCommands, "skills", "suggest");

    expect(mockGetValidAccessToken).toHaveBeenCalled();
    expect(mockSuggestSkills).toHaveBeenCalledWith(["react"], REFRESHED);
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
