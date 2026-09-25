import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { Command } from "commander";

const mockSearchDocumentation = vi.fn();
vi.mock("../utils/api.js", () => ({
  searchDocumentation: (...args: unknown[]) => mockSearchDocumentation(...args),
}));

const mockGetValidAccessToken = vi.fn();
vi.mock("../utils/auth.js", () => ({
  getValidAccessToken: (...args: unknown[]) => mockGetValidAccessToken(...args),
}));

vi.mock("../utils/tracking.js", () => ({ trackEvent: vi.fn() }));

const mockSpinner = {
  start: vi.fn().mockReturnThis(),
  stop: vi.fn().mockReturnThis(),
  fail: vi.fn().mockReturnThis(),
};
vi.mock("ora", () => ({ default: () => mockSpinner }));

import { registerSearchCommand } from "../commands/search.js";

async function run(...args: string[]): Promise<void> {
  const program = new Command();
  program.exitOverride();
  registerSearchCommand(program);
  await program.parseAsync(["node", "test", ...args]);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  mockGetValidAccessToken.mockResolvedValue("refreshed-token");
  process.exitCode = undefined;
});

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

describe("ctx7 search", () => {
  test("forwards repeated library hints and ranking preferences", async () => {
    mockSearchDocumentation.mockResolvedValue({ codeSnippets: [], infoSnippets: [] });

    await run(
      "search",
      "how do I stream a response?",
      "--library",
      "Next.js",
      "--library",
      "OpenAI",
      "--version",
      "15.4.0",
      "--language",
      "TypeScript",
      "--json"
    );

    expect(mockSearchDocumentation).toHaveBeenCalledWith(
      "how do I stream a response?",
      {
        libraries: ["Next.js", "OpenAI"],
        version: "15.4.0",
        language: "TypeScript",
        type: "json",
      },
      "refreshed-token"
    );
  });

  test("uses text output by default", async () => {
    mockSearchDocumentation.mockResolvedValue("documentation text");

    await run("search", "how do I validate input?");

    expect(mockSearchDocumentation).toHaveBeenCalledWith(
      "how do I validate input?",
      {
        libraries: undefined,
        version: undefined,
        language: undefined,
        type: "txt",
      },
      "refreshed-token"
    );
    expect(console.log).toHaveBeenCalledWith("documentation text");
  });

  test("requires a library hint when a version is provided", async () => {
    await run("search", "how do I cache a function?", "--version", "15.4.0");

    expect(mockSearchDocumentation).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });
});
