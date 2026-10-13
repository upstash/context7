import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { Command } from "commander";

vi.mock("../utils/auth.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../utils/auth.js")>()),
  getValidAccessToken: async () => undefined,
}));

vi.mock("../utils/tracking.js", () => ({ trackEvent: vi.fn() }));

import { registerSearchCommand } from "../commands/search.js";

const fetchMock = vi.fn();
const originalArgv = process.argv;

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "log").mockImplementation(() => {});
  process.exitCode = undefined;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  fetchMock.mockReset();
  process.argv = originalArgv;
  process.exitCode = undefined;
});

describe("ctx7 search", () => {
  // Runs the real root program: a `--version` option on the subcommand is taken
  // by the root `-v, --version` flag and never reaches the request.
  test("sends the query, hints and library version to the v3 Search API", async () => {
    fetchMock.mockResolvedValue(new Response("documentation text"));
    process.argv = [
      "node",
      "ctx7",
      "search",
      "how do I stream a response?",
      "--library",
      "Next.js",
      "--library",
      "/openai/openai-node",
      "--library-version",
      "15.4.0",
      "--language",
      "TypeScript",
    ];

    await import("../index.js");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://context7.com/api/v3/search?query=how+do+I+stream+a+response%3F&type=txt&library=Next.js&library=%2Fopenai%2Fopenai-node&version=15.4.0&language=TypeScript"
    );
    expect(console.log).toHaveBeenCalledWith("documentation text");
  });

  test("shows the API message and fails when the search has no result", async () => {
    fetchMock.mockResolvedValue(
      Response.json(
        { error: "no_documentation_found", message: "No documentation library matched" },
        { status: 404 }
      )
    );

    const program = new Command();
    registerSearchCommand(program);
    await program.parseAsync(["node", "ctx7", "search", "missing docs", "--json"]);

    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining("No documentation library matched")
    );
    expect(process.exitCode).toBe(1);
  });
});
