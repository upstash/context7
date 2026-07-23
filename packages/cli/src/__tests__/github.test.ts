import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const execFileSync = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({ execFileSync }));

import { downloadSkillFromGitHub, listSkillsFromGitHub } from "../utils/github.js";

const SKILL = {
  name: "context7-mcp",
  description: "desc",
  project: "/upstash/context7",
  url: "https://raw.githubusercontent.com/upstash/context7/refs/heads/master/plugins/codex/context7/skills/context7-mcp/SKILL.md",
};

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

describe("downloadSkillFromGitHub", () => {
  test("downloads every file in the skill directory when the tree API works", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (url.includes("api.github.com")) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                sha: "s",
                truncated: false,
                tree: [
                  { type: "tree", path: "plugins/codex/context7/skills/context7-mcp" },
                  {
                    type: "blob",
                    path: "plugins/codex/context7/skills/context7-mcp/SKILL.md",
                  },
                  {
                    type: "blob",
                    path: "plugins/codex/context7/skills/context7-mcp/references/guide.md",
                  },
                ],
              }),
          });
        }
        return Promise.resolve({ ok: true, text: () => Promise.resolve(`raw:${url}`) });
      })
    );

    const result = await downloadSkillFromGitHub(SKILL);

    expect(result.error).toBeUndefined();
    expect(result.files.map((f) => f.path).sort()).toEqual(["SKILL.md", "references/guide.md"]);
  });

  test("falls back to the single SKILL.md when the tree API is unreachable (#2936)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (url.includes("api.github.com")) {
          return Promise.reject(new TypeError("fetch failed"));
        }
        return Promise.resolve({ ok: true, text: () => Promise.resolve("# Context7 skill") });
      })
    );

    const result = await downloadSkillFromGitHub(SKILL);

    expect(result.error).toBeUndefined();
    expect(result.files).toEqual([{ path: "SKILL.md", content: "# Context7 skill" }]);
  });

  test("surfaces the tree error when both the tree API and the direct fetch fail", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (url.includes("api.github.com")) {
          return Promise.reject(new TypeError("fetch failed"));
        }
        return Promise.resolve({ ok: false, status: 404 });
      })
    );

    const result = await downloadSkillFromGitHub(SKILL);

    expect(result.files).toEqual([]);
    expect(result.error).toBe("fetch failed");
  });
});
