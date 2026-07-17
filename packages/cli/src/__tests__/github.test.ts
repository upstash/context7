import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const execFileSync = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({ execFileSync }));

import { listSkillsFromGitHub } from "../utils/github.js";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("GITHUB_TOKEN", undefined);
  vi.stubEnv("GH_TOKEN", undefined);
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ default_branch: "main" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ sha: "tree-sha", tree: [], truncated: false }),
      })
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("GitHub authentication", () => {
  test("reads the GitHub CLI token without invoking a shell", async () => {
    execFileSync.mockReturnValue("cli-token\n");

    await listSkillsFromGitHub("upstash/context7");

    expect(execFileSync).toHaveBeenCalledWith("gh", ["auth", "token"], {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "ignore"],
    });
    expect(vi.mocked(fetch).mock.calls[0][1]).toMatchObject({
      headers: expect.objectContaining({ Authorization: "token cli-token" }),
    });
  });

  test("prefers an environment token over invoking the GitHub CLI", async () => {
    vi.stubEnv("GITHUB_TOKEN", "env-token");

    await listSkillsFromGitHub("upstash/context7");

    expect(execFileSync).not.toHaveBeenCalled();
    expect(vi.mocked(fetch).mock.calls[0][1]).toMatchObject({
      headers: expect.objectContaining({ Authorization: "token env-token" }),
    });
  });

  test("continues without authentication when the GitHub CLI is unavailable", async () => {
    execFileSync.mockImplementation(() => {
      throw new Error("gh not found");
    });

    await listSkillsFromGitHub("upstash/context7");

    const headers = vi.mocked(fetch).mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers).not.toHaveProperty("Authorization");
  });
});
