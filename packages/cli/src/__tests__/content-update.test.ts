import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { mkdir, readFile, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

import {
  getManifest,
  hashContent,
  hashFiles,
  resetManifestCache,
  resolveSkill,
} from "../utils/content.js";
import { readCliState, writeCliState, type Install } from "../utils/cli-state.js";
import { scanOutdated } from "../commands/update.js";

const SKILL_BODY = "---\nname: find-docs\n---\n\nFind docs.\n";

let tempDir: string;
let stateFile: string;
let skillDir: string;

function manifestWith(revision: number, minCliVersion = "0.0.0") {
  return {
    schema: 1,
    skills: {
      "find-docs": {
        revision,
        minCliVersion,
        files: [{ path: "SKILL.md", hash: hashContent(SKILL_BODY) }],
      },
    },
    rules: {},
  };
}

function stubFetch(manifest: unknown, body = SKILL_BODY) {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      if (url.endsWith("skills/manifest.json")) {
        return Promise.resolve({ ok: true, text: () => Promise.resolve(JSON.stringify(manifest)) });
      }
      if (url.endsWith("skills/find-docs/SKILL.md")) {
        return Promise.resolve({ ok: true, text: () => Promise.resolve(body) });
      }
      return Promise.resolve({ ok: false });
    })
  );
}

async function recordSkill(revision: number, hash: string): Promise<void> {
  const install: Install = {
    kind: "skill",
    name: "find-docs",
    agent: "claude",
    scope: "global",
    revision,
    hash,
    files: ["SKILL.md"],
  };
  await writeCliState({ installs: { [skillDir]: install } });
}

beforeEach(async () => {
  tempDir = join(tmpdir(), `ctx7-content-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  stateFile = join(tempDir, "cli-state.json");
  skillDir = join(tempDir, "skills", "find-docs");
  await mkdir(skillDir, { recursive: true });
  vi.stubEnv("CTX7_STATE_FILE", stateFile);
  resetManifestCache();
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("getManifest", () => {
  test("caches the manifest in the state file", async () => {
    stubFetch(manifestWith(2));
    await getManifest({ now: 1000 });

    const state = await readCliState();
    expect(state.contentManifest?.fetchedAt).toBe(1000);
    expect(state.contentManifest?.manifest.skills["find-docs"].revision).toBe(2);
  });

  test("serves the cached manifest inside the TTL without fetching", async () => {
    await writeCliState({ contentManifest: { fetchedAt: 1000, manifest: manifestWith(5) } });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const manifest = await getManifest({ now: 1000 + 60_000 });
    expect(manifest?.skills["find-docs"].revision).toBe(5);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("keeps the cached manifest when the network is unavailable", async () => {
    await writeCliState({ contentManifest: { fetchedAt: 0, manifest: manifestWith(5) } });
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("offline")))
    );

    const manifest = await getManifest({ now: 10 * 24 * 60 * 60 * 1000 });
    expect(manifest?.skills["find-docs"].revision).toBe(5);
  });
});

describe("resolveSkill", () => {
  test("returns files whose hash matches the manifest", async () => {
    stubFetch(manifestWith(3));
    const resolved = await resolveSkill("find-docs");

    expect(resolved?.revision).toBe(3);
    expect(resolved?.files).toEqual([{ path: "SKILL.md", content: SKILL_BODY }]);
  });

  test("rejects content that does not match the manifest hash", async () => {
    stubFetch(manifestWith(3), "tampered content\n");
    expect(await resolveSkill("find-docs")).toBeNull();
  });

  test("returns null for a skill missing from the manifest", async () => {
    stubFetch(manifestWith(3));
    expect(await resolveSkill("nonexistent")).toBeNull();
  });
});

describe("scanOutdated", () => {
  beforeEach(async () => {
    await writeFile(join(skillDir, "SKILL.md"), SKILL_BODY);
  });

  test("reports nothing when the installed revision is current", async () => {
    stubFetch(manifestWith(3));
    await recordSkill(3, hashFiles([{ path: "SKILL.md", content: SKILL_BODY }]));

    expect(await scanOutdated()).toEqual([]);
  });

  test("reports an install behind the manifest revision", async () => {
    stubFetch(manifestWith(4));
    await recordSkill(3, hashFiles([{ path: "SKILL.md", content: SKILL_BODY }]));

    const outdated = await scanOutdated();
    expect(outdated).toHaveLength(1);
    expect(outdated[0].latest).toBe(4);
    expect(outdated[0].edited).toBe(false);
    expect(outdated[0].blockedBy).toBeUndefined();
  });

  test("flags locally modified installs", async () => {
    stubFetch(manifestWith(4));
    await recordSkill(3, hashFiles([{ path: "SKILL.md", content: SKILL_BODY }]));
    await writeFile(join(skillDir, "SKILL.md"), "hand edited\n");

    const outdated = await scanOutdated();
    expect(outdated[0].edited).toBe(true);
  });

  test("blocks updates that require a newer CLI", async () => {
    stubFetch(manifestWith(4, "999.0.0"));
    await recordSkill(3, hashFiles([{ path: "SKILL.md", content: SKILL_BODY }]));

    const outdated = await scanOutdated();
    expect(outdated[0].blockedBy).toBe("999.0.0");
  });

  test("forgets installs whose files are gone", async () => {
    stubFetch(manifestWith(4));
    await recordSkill(3, hashFiles([{ path: "SKILL.md", content: SKILL_BODY }]));
    await rm(join(skillDir, "SKILL.md"));

    expect(await scanOutdated()).toEqual([]);
    expect((await readCliState()).installs).toEqual({});
  });

  test("returns nothing when the manifest is unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ ok: false }))
    );
    await recordSkill(3, hashFiles([{ path: "SKILL.md", content: SKILL_BODY }]));

    expect(await scanOutdated()).toEqual([]);
  });
});

describe("installSkillFiles", () => {
  test("removes files that are no longer part of the skill", async () => {
    const { installSkillFiles } = await import("../utils/installer.js");
    const root = join(tempDir, "skills");

    await installSkillFiles("find-docs", [{ path: "SKILL.md", content: SKILL_BODY }], root, [
      "references/old.md",
    ]);

    await mkdir(join(skillDir, "references"), { recursive: true });
    await writeFile(join(skillDir, "references", "old.md"), "stale\n");

    await installSkillFiles("find-docs", [{ path: "SKILL.md", content: SKILL_BODY }], root, [
      "references/old.md",
    ]);

    await expect(readFile(join(skillDir, "references", "old.md"), "utf-8")).rejects.toThrow();
    expect(await readFile(join(skillDir, "SKILL.md"), "utf-8")).toBe(SKILL_BODY);
  });
});
