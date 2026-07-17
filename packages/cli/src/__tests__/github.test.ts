import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const execFileSync = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({ execFileSync }));

import { listSkillsFromGitHub } from "../utils/github.js";

beforeEach(() => {
  // resetAllMocks, not clearAllMocks: the latter keeps implementations, so a
  // mockImplementation set by one test would leak into the next.
  vi.resetAllMocks();
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

    const result = await listSkillsFromGitHub("upstash/context7");

    // No shell string and no `shell` option: the whole point of #2918.
    expect(execFileSync).toHaveBeenCalledWith("gh", ["auth", "token"], {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "ignore"],
    });
    expect(result).toEqual({ status: "ok", skills: [] });
    expect(vi.mocked(fetch).mock.calls[0][1]).toMatchObject({
      headers: expect.objectContaining({ Authorization: "token cli-token" }),
    });
  });

  test("prefers an environment token over invoking the GitHub CLI", async () => {
    vi.stubEnv("GITHUB_TOKEN", "env-token");

    const result = await listSkillsFromGitHub("upstash/context7");

    expect(execFileSync).not.toHaveBeenCalled();
    expect(result).toEqual({ status: "ok", skills: [] });
    expect(vi.mocked(fetch).mock.calls[0][1]).toMatchObject({
      headers: expect.objectContaining({ Authorization: "token env-token" }),
    });
  });

  test("falls back to GH_TOKEN when GITHUB_TOKEN is unset", async () => {
    vi.stubEnv("GH_TOKEN", "gh-env-token");

    const result = await listSkillsFromGitHub("upstash/context7");

    expect(execFileSync).not.toHaveBeenCalled();
    expect(result).toEqual({ status: "ok", skills: [] });
    expect(vi.mocked(fetch).mock.calls[0][1]).toMatchObject({
      headers: expect.objectContaining({ Authorization: "token gh-env-token" }),
    });
  });

  test("continues without authentication when the GitHub CLI is unavailable", async () => {
    execFileSync.mockImplementation(() => {
      throw Object.assign(new Error("spawnSync gh ENOENT"), { code: "ENOENT" });
    });

    const result = await listSkillsFromGitHub("upstash/context7");

    // A missing or unresolvable gh degrades to unauthenticated requests, it does not throw.
    expect(result).toEqual({ status: "ok", skills: [] });
    const headers = vi.mocked(fetch).mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers).not.toHaveProperty("Authorization");
  });
});
