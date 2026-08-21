import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { mkdir, readFile, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

const downloadSkill = vi.fn();
vi.mock("../utils/api.js", () => ({
  downloadSkill: (...args: unknown[]) => downloadSkill(...args),
  getBaseUrl: () => "https://context7.com",
}));

import { hashContent, hashFiles, resetManifestCache } from "../utils/content.js";
import { resetSkillContentCache } from "../setup/skills.js";
import { readCliState, writeCliState, type Install } from "../utils/cli-state.js";
import { autoUpdateContent } from "../commands/update.js";

const INSTALLED = "---\nname: find-docs\n---\n\nInstalled body.\n";
const LEGACY = "---\nname: find-docs\n---\n\nLegacy download body.\n";

let tempDir: string;
let stateFile: string;
let skillDir: string;

/** Manifest advertises r7, but the raw file fetch never yields matching content. */
function stubUnresolvableContent() {
  const manifest = {
    schema: 1,
    skills: {
      "find-docs": {
        revision: 7,
        minCliVersion: "0.0.0",
        files: [{ path: "SKILL.md", hash: hashContent("something else entirely") }],
      },
    },
    rules: {},
  };

  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      if (url.endsWith("skills/manifest.json")) {
        return Promise.resolve({ ok: true, text: () => Promise.resolve(JSON.stringify(manifest)) });
      }
      if (url.endsWith("skills/find-docs/SKILL.md")) {
        return Promise.resolve({ ok: true, text: () => Promise.resolve("stale mirror content\n") });
      }
      return Promise.resolve({ ok: false });
    })
  );
}

async function recordAt(revision: number, content: string): Promise<void> {
  const install: Install = {
    kind: "skill",
    name: "find-docs",
    agent: "claude",
    scope: "global",
    revision,
    hash: hashFiles([{ path: "SKILL.md", content }]),
    files: ["SKILL.md"],
  };
  await writeCliState({ installs: { [skillDir]: install } });
}

beforeEach(async () => {
  tempDir = join(tmpdir(), `ctx7-safety-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  stateFile = join(tempDir, "cli-state.json");
  skillDir = join(tempDir, "skills", "find-docs");
  await mkdir(skillDir, { recursive: true });
  await writeFile(join(skillDir, "SKILL.md"), INSTALLED);
  vi.stubEnv("CTX7_STATE_FILE", stateFile);
  resetManifestCache();
  resetSkillContentCache();
  downloadSkill.mockReset();
  downloadSkill.mockResolvedValue({
    skill: { name: "find-docs", description: "", url: "", project: "/upstash/context7" },
    files: [{ path: "SKILL.md", content: LEGACY }],
  });
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("auto-update never downgrades an install", () => {
  test("leaves the record alone when manifest content cannot be resolved", async () => {
    stubUnresolvableContent();
    await recordAt(5, INSTALLED);

    await autoUpdateContent({ actionName: "docs" });

    const install = (await readCliState()).installs?.[skillDir];
    expect(install?.revision).toBe(5);
    expect(await readFile(join(skillDir, "SKILL.md"), "utf-8")).toBe(INSTALLED);
  });

  test("does not fall back to the legacy download path when refreshing", async () => {
    stubUnresolvableContent();
    await recordAt(5, INSTALLED);

    await autoUpdateContent({ actionName: "docs" });

    expect(downloadSkill).not.toHaveBeenCalled();
  });

  test("does not re-attempt on every invocation after a failure", async () => {
    stubUnresolvableContent();
    await recordAt(5, INSTALLED);

    await autoUpdateContent({ actionName: "docs" });
    const afterFirst = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.length;

    await autoUpdateContent({ actionName: "docs" });
    await autoUpdateContent({ actionName: "docs" });

    expect((global.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(afterFirst);
  });

  test("resumes once the backoff window has passed", async () => {
    stubUnresolvableContent();
    await recordAt(5, INSTALLED);

    const start = Date.now();
    await autoUpdateContent({ actionName: "docs", now: start });
    const afterFirst = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.length;

    await autoUpdateContent({ actionName: "docs", now: start + 2 * 60 * 60 * 1000 });

    expect((global.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(
      afterFirst
    );
  });
});

describe("corrupt state file", () => {
  test("is quarantined so install tracking is not disabled forever", async () => {
    await writeFile(stateFile, "{ this is not json");

    expect(await readCliState()).toEqual({});
    expect(await readFile(`${stateFile}.corrupt`, "utf-8")).toBe("{ this is not json");
  });

  test("leaves a usable state file after the next write", async () => {
    await writeFile(stateFile, "}}broken");
    await readCliState();
    await writeCliState({ contentNotifiedAt: 42 });

    expect(JSON.parse(await readFile(stateFile, "utf-8"))).toEqual({ contentNotifiedAt: 42 });
  });
});
