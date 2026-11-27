import { createDecipheriv } from "node:crypto";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { ServerContext } from "@modelcontextprotocol/server";
import { skillEntry, type Skill } from "@modelcontextprotocol/server/ext/skills";
import { apiKeyHash } from "../src/lib/credential-owner.js";
import {
  fetchTeamSkillFile,
  isTeamSkillsSnapshotEnabled,
  refreshTeamSkillsSnapshot,
  STALE_AFTER_MS,
  startTeamSkillsSnapshot,
  stopTeamSkillsSnapshot,
  teamSkillsFor,
  teamspaceOf,
  TEAM_SKILLS_FILE_PATH,
  TEAM_SKILLS_SNAPSHOT_PATH,
} from "../src/lib/team-skills-snapshot.js";
import { defaultOAuthAllowedAudiences } from "../src/lib/oauth-audience.js";
import { resetTeamSkillFileCache, skillSource } from "../src/lib/skills.js";
import {
  resetOpaqueOAuthTokenValidation,
  validateOpaqueOAuthToken,
} from "../src/lib/oauth-token-validation.js";

const ASSERTION_KEY = "0123456789abcdef".repeat(4);
const KEY = "ctx7sk-11111111-2222-3333-4444-555555555555";
const CTX = {} as ServerContext;

const GUIDE_MD = "---\nname: team-guide\ndescription: How the team ships.\n---\n# Team guide\n";
const NOTES_MD = "# Release notes\n";
const LOGO = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0xff, 0xfe]);
const REVIEW_MD = "---\nname: review\ndescription: How the team reviews.\n---\n# Review\n";
const GUIDE = await skillEntry("team-guide", {
  "SKILL.md": GUIDE_MD,
  "references/notes.md": NOTES_MD,
  "assets/logo.png": LOGO,
});
const REVIEW = await skillEntry("review", { "SKILL.md": REVIEW_MD });

/** An unsigned JWT: the snapshot reads `sub` only after the auth gate verified the token. */
const jwt = (header: object, payload: object) =>
  [header, payload, "sig"]
    .map((part) =>
      Buffer.from(typeof part === "string" ? part : JSON.stringify(part)).toString("base64url")
    )
    .join(".");
const clerkJwt = (sub: string) =>
  jwt({ alg: "RS256", typ: "at+jwt" }, { iss: "https://clerk.context7.com", sub });
const otherJwt = (sub: string) =>
  jwt({ alg: "RS256" }, { iss: "https://login.microsoftonline.com/x", sub });

/** Opens the assertion the way the app does (`openMcpAssertion("s1", …)`). */
function openAssertion(assertion: string): string | null {
  const [tag, timestamp, nonce, sealed] = assertion.split(":");
  if (tag !== "s1" || !sealed) return null;
  const bytes = Buffer.from(sealed, "hex");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    Buffer.from(ASSERTION_KEY, "hex"),
    Buffer.from(nonce, "hex")
  );
  decipher.setAAD(Buffer.from(`${tag}:${timestamp}`));
  decipher.setAuthTag(bytes.subarray(-16));
  return Buffer.concat([decipher.update(bytes.subarray(0, -16)), decipher.final()]).toString();
}

const uris = (skills: readonly Skill[] | undefined) => skills?.map((skill) => skill.uri);
const fileOf = (skill: Skill, path: string) =>
  (skill.resources as { uri: string; digest: string; size: number }[]).find((entry) =>
    entry.uri.endsWith(`/${path}`)
  )!;

/** A stand-in for the app's two routes. */
function fakeApp() {
  const state = {
    version: "1",
    teams: { team_a: [GUIDE, REVIEW], team_b: [REVIEW] } as Record<string, unknown[]>,
    apiKeys: { [apiKeyHash(KEY)]: "team_a" } as Record<string, string>,
    users: { user_b: "team_b" } as Record<string, string>,
    files: new Map<string, Uint8Array>(),
    down: false,
    full: 0,
    notModified: 0,
    fileReads: [] as URLSearchParams[],
  };
  // The team-guide files by digest, as the app stores them.
  for (const [path, content] of [
    ["SKILL.md", new TextEncoder().encode(GUIDE_MD)],
    ["references/notes.md", new TextEncoder().encode(NOTES_MD)],
    ["assets/logo.png", LOGO],
  ] as const) {
    state.files.set(fileOf(GUIDE, path).digest, content);
  }
  const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
    if (state.down) throw new TypeError("fetch failed");
    const { pathname, searchParams } = new URL(String(url));
    const subject = openAssertion(new Headers(init?.headers).get("X-Context7-Mcp-Assertion") ?? "");
    if (pathname.endsWith(TEAM_SKILLS_FILE_PATH)) {
      if (subject !== "team-skills-file") return new Response(null, { status: 401 });
      state.fileReads.push(searchParams);
      const bytes = state.files.get(searchParams.get("digest") ?? "");
      return bytes ? new Response(bytes) : new Response(null, { status: 404 });
    }
    expect(pathname).toMatch(new RegExp(`${TEAM_SKILLS_SNAPSHOT_PATH}$`));
    if (subject !== "team-skills-snapshot") return new Response(null, { status: 401 });
    if (new Headers(init?.headers).get("If-None-Match") === `"${state.version}"`) {
      state.notModified++;
      return new Response(null, { status: 304 });
    }
    state.full++;
    const { version, teams, apiKeys, users } = state;
    return new Response(JSON.stringify({ version, teams, apiKeys, users }), { status: 200 });
  });
  return { state, fetchMock };
}

beforeEach(() => {
  vi.stubEnv("MCP_CLIENT_IP_ASSERTION_KEY", ASSERTION_KEY);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  stopTeamSkillsSnapshot();
  resetTeamSkillFileCache();
  resetOpaqueOAuthTokenValidation();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("team skills snapshot", () => {
  test("is on only for a process with the shared assertion key", async () => {
    vi.stubEnv("MCP_CLIENT_IP_ASSERTION_KEY", "");
    const { fetchMock } = fakeApp();
    vi.stubGlobal("fetch", fetchMock);
    await startTeamSkillsSnapshot();
    expect(isTeamSkillsSnapshotEnabled()).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(teamspaceOf(KEY)).toBeUndefined();
  });

  test("finds the teamspace of every credential kind from memory", async () => {
    const { fetchMock } = fakeApp();
    vi.stubGlobal("fetch", fetchMock);
    await startTeamSkillsSnapshot();
    expect(isTeamSkillsSnapshotEnabled()).toBe(true);
    const calls = fetchMock.mock.calls.length;

    expect(teamspaceOf(KEY)).toBe("team_a");
    expect(teamspaceOf(clerkJwt("user_b"))).toBe("team_b");
    expect(teamspaceOf(clerkJwt("nobody"))).toBeUndefined();
    expect(teamspaceOf(otherJwt("user_b"))).toBeUndefined();
    expect(teamspaceOf("ctx7sk-unknown")).toBeUndefined();
    expect(teamspaceOf(undefined)).toBeUndefined();
    expect(uris(teamSkillsFor("team_a")?.skills)).toEqual([REVIEW.uri, GUIDE.uri]);
    expect(teamSkillsFor("team_none")).toBeUndefined();
    // Reading the snapshot never calls out.
    expect(fetchMock.mock.calls.length).toBe(calls);
  });

  test("gives a Clerk token issued for another resource no teamspace", async () => {
    const { fetchMock } = fakeApp();
    vi.stubGlobal("fetch", fetchMock);
    await startTeamSkillsSnapshot();
    const token = (aud?: string) =>
      jwt(
        { alg: "RS256", typ: "at+jwt" },
        { iss: "https://clerk.context7.com", sub: "user_b", ...(aud ? { aud } : {}) }
      );
    expect(teamspaceOf(token(defaultOAuthAllowedAudiences()[1]))).toBe("team_b");
    expect(teamspaceOf(token("https://gateway.example.com/mcp"))).toBeUndefined();
    // Grants from before Clerk filled `aud` still count.
    expect(teamspaceOf(token())).toBe("team_b");
    // An audience spelled like the checker's "missing" label is still an audience it refuses.
    expect(teamspaceOf(token("missing"))).toBeUndefined();
  });

  test("stops resolving credentials once the snapshot is stale, until a poll succeeds", async () => {
    const { state, fetchMock } = fakeApp();
    vi.stubGlobal("fetch", fetchMock);
    await startTeamSkillsSnapshot();
    expect(teamspaceOf(KEY)).toBe("team_a");

    const start = Date.now();
    const now = vi.spyOn(Date, "now");
    state.down = true;
    now.mockReturnValue(start + STALE_AFTER_MS - 1_000);
    await refreshTeamSkillsSnapshot();
    expect(teamspaceOf(KEY)).toBe("team_a");

    now.mockReturnValue(start + STALE_AFTER_MS + 1_000);
    expect(teamspaceOf(KEY)).toBeUndefined();
    expect(teamspaceOf(clerkJwt("user_b"))).toBeUndefined();
    // The skills stay in memory; only the credential maps stop counting.
    expect(teamSkillsFor("team_a")).toBeDefined();

    state.down = false;
    await refreshTeamSkillsSnapshot();
    expect(teamspaceOf(KEY)).toBe("team_a");
  });

  test("drops a file body that runs past its entry's size, with no Content-Length", async () => {
    await startTeamSkillsSnapshot(false);
    vi.stubEnv("MCP_CLIENT_IP_ASSERTION_KEY", ASSERTION_KEY);
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(64));
      },
      cancel() {
        cancelled = true;
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(body))
    );
    await expect(
      fetchTeamSkillFile("team_a", fileOf(GUIDE, "SKILL.md").digest, 100)
    ).rejects.toThrow("larger than its entry's 100 bytes");
    expect(cancelled).toBe(true);
  });

  test("finds an opaque OAuth token's teamspace once its auth check named the user", async () => {
    const { fetchMock } = fakeApp();
    vi.stubGlobal("fetch", fetchMock);
    await startTeamSkillsSnapshot();
    expect(teamspaceOf("oat_z")).toBeUndefined();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => new Response(null, { status: 204, headers: { "X-Context7-User-Id": "user_b" } })
      )
    );
    await validateOpaqueOAuthToken("oat_z");
    expect(teamspaceOf("oat_z")).toBe("team_b");
  });

  test("reads the whole snapshot again only after it changed", async () => {
    const { state, fetchMock } = fakeApp();
    vi.stubGlobal("fetch", fetchMock);
    await startTeamSkillsSnapshot();
    await refreshTeamSkillsSnapshot();
    await refreshTeamSkillsSnapshot();
    expect(state.full).toBe(1);
    expect(state.notModified).toBe(2);

    state.teams.team_a = [GUIDE];
    state.version = "2";
    await refreshTeamSkillsSnapshot();
    expect(state.full).toBe(2);
    expect(uris(teamSkillsFor("team_a")?.skills)).toEqual([GUIDE.uri]);
  });

  test("keeps serving the last snapshot while the app is down", async () => {
    const { state, fetchMock } = fakeApp();
    vi.stubGlobal("fetch", fetchMock);
    await startTeamSkillsSnapshot();
    state.down = true;
    for (let i = 0; i < 5; i++) await refreshTeamSkillsSnapshot();
    expect(teamspaceOf(KEY)).toBe("team_a");
    expect(uris(teamSkillsFor("team_a")?.skills)).toEqual([REVIEW.uri, GUIDE.uri]);
    // Only the first failures of a streak are logged.
    expect(vi.mocked(console.error).mock.calls).toHaveLength(3);
    state.down = false;
    await refreshTeamSkillsSnapshot();
    expect(vi.mocked(console.error).mock.calls.at(-1)?.[0]).toContain(
      "read again after 5 failures"
    );
  });

  test("drops entries the skills extension would refuse and keeps the rest", async () => {
    const { state, fetchMock } = fakeApp();
    const reserved = await skillEntry("context7-mcp", {
      "SKILL.md": "---\nname: context7-mcp\ndescription: Not ours.\n---\n",
    });
    const files = GUIDE.resources as { uri: string; digest: string; size: number }[];
    state.teams.team_a = [
      reserved,
      { ...GUIDE, uri: "skill://other/SKILL.md" },
      { ...GUIDE, resources: [...files, { ...files[0], uri: "skill://review/SKILL.md" }] },
      { ...GUIDE, resources: [...files, { ...files[0], uri: "skill://team-guide/a%2Fb" }] },
      { ...GUIDE, resources: files.map((file) => ({ ...file, digest: "sha256:abc" })) },
      { ...GUIDE, resources: files.filter((file) => !file.uri.endsWith("/SKILL.md")) },
      { ...GUIDE, frontmatter: { ...GUIDE.frontmatter, metadata: { level: 1 } } },
      { ...GUIDE, resources: files.map((file) => ({ ...file, size: 17 * 1024 * 1024 })) },
      "not an entry",
      REVIEW,
    ];
    vi.stubGlobal("fetch", fetchMock);
    await startTeamSkillsSnapshot();
    expect(uris(teamSkillsFor("team_a")?.skills)).toEqual([REVIEW.uri]);
    expect(vi.mocked(console.error).mock.calls).toHaveLength(9);
  });
});

describe("skill source", () => {
  async function started() {
    const app = fakeApp();
    vi.stubGlobal("fetch", app.fetchMock);
    await startTeamSkillsSnapshot();
    return app;
  }

  test("lists context7-mcp, then the teamspace's skills", async () => {
    await started();
    const { skills } = await skillSource("team_a").list({}, CTX);
    expect(uris(skills)).toEqual(["skill://context7-mcp/SKILL.md", REVIEW.uri, GUIDE.uri]);
    expect(uris((await skillSource(undefined).list({}, CTX)).skills)).toEqual([
      "skill://context7-mcp/SKILL.md",
    ]);
    expect(await skillSource("team_b").get(GUIDE.uri, CTX)).toBeUndefined();
    expect(await skillSource("team_a").get(GUIDE.uri, CTX)).toEqual(GUIDE);
  });

  test("names only context7-mcp in resources/list, which is cached publicly", async () => {
    await started();
    const resources = await skillSource("team_a").listResources!(CTX);
    expect(resources.map((resource) => resource.uri)).toEqual(["skill://context7-mcp/SKILL.md"]);
  });

  test("reads a team file once, verified against its digest", async () => {
    const { state } = await started();
    const source = skillSource("team_a");
    const notes = fileOf(GUIDE, "references/notes.md");
    for (let i = 0; i < 2; i++) {
      expect(await source.read(notes.uri, CTX)).toEqual({
        text: NOTES_MD,
        mimeType: "text/markdown",
      });
    }
    expect(state.fileReads).toHaveLength(1);
    expect(state.fileReads[0].get("teamspace")).toBe("team_a");
    expect(state.fileReads[0].get("digest")).toBe(notes.digest);

    // Bytes that are not UTF-8 are sent as bytes.
    expect(await source.read(fileOf(GUIDE, "assets/logo.png").uri, CTX)).toEqual({
      bytes: LOGO,
      mimeType: "image/png",
    });
  });

  test("refuses bytes that do not match the entry, and does not keep them", async () => {
    const { state } = await started();
    const notes = fileOf(GUIDE, "references/notes.md");
    // Same length as the real notes, other bytes: only the digest tells them apart.
    state.files.set(notes.digest, new TextEncoder().encode("# Release notez\n"));
    const source = skillSource("team_a");
    await expect(source.read(notes.uri, CTX)).rejects.toThrow("does not match its skill entry");
    await expect(source.read(notes.uri, CTX)).rejects.toThrow("does not match its skill entry");
    expect(state.fileReads).toHaveLength(2);

    // Longer than the entry: refused while it is read.
    state.files.set(notes.digest, new TextEncoder().encode("# Release notes, longer\n"));
    await expect(source.read(notes.uri, CTX)).rejects.toThrow("could not be read");
  });

  test("holds a cached file to the size of the entry that reads it", async () => {
    const { state } = await started();
    const notes = fileOf(GUIDE, "references/notes.md");
    await skillSource("team_a").read(notes.uri, CTX);
    // Another teamspace's entry lists the same digest with a wrong size.
    state.teams.team_c = [
      {
        ...GUIDE,
        resources: (GUIDE.resources as { uri: string; digest: string; size: number }[]).map(
          (file) => (file.uri === notes.uri ? { ...file, size: file.size + 1 } : file)
        ),
      },
    ];
    state.version = "2";
    await refreshTeamSkillsSnapshot();
    await expect(skillSource("team_c").read(notes.uri, CTX)).rejects.toThrow(
      "does not match its skill entry"
    );
    expect(state.fileReads).toHaveLength(1);
  });

  test("fails a read the app cannot answer", async () => {
    const { state } = await started();
    state.files.clear();
    await expect(
      skillSource("team_a").read(fileOf(GUIDE, "references/notes.md").uri, CTX)
    ).rejects.toThrow("could not be read");
  });

  test("serves context7-mcp to everyone and team files only to their teamspace", async () => {
    const { state } = await started();
    const manifest = await skillSource(undefined).read("skill://context7-mcp/SKILL.md", CTX);
    expect(manifest).toMatchObject({ mimeType: "text/markdown" });
    expect((manifest as { text: string }).text).toContain("name: context7-mcp");
    expect(await skillSource("team_b").read(GUIDE.uri, CTX)).toBeUndefined();
    expect(await skillSource(undefined).read(GUIDE.uri, CTX)).toBeUndefined();
    expect(await skillSource("team_a").read("skill://team-guide/missing.md", CTX)).toBeUndefined();
    expect(state.fileReads).toHaveLength(0);
  });

  test("lists a skill directory's direct children", async () => {
    await started();
    const source = skillSource("team_a");
    expect(await source.readDirectory!("skill://team-guide", {}, CTX)).toEqual({
      resources: [
        {
          uri: "skill://team-guide/SKILL.md",
          name: "SKILL.md",
          mimeType: "text/markdown",
          size: fileOf(GUIDE, "SKILL.md").size,
        },
        { uri: "skill://team-guide/assets", name: "assets", mimeType: "inode/directory" },
        { uri: "skill://team-guide/references", name: "references", mimeType: "inode/directory" },
      ],
    });
    expect(
      (await source.readDirectory!("skill://team-guide/references", {}, CTX))?.resources
    ).toEqual([
      expect.objectContaining({ uri: "skill://team-guide/references/notes.md", name: "notes.md" }),
    ]);
    expect(await source.readDirectory!("skill://team-guide/SKILL.md", {}, CTX)).toBeUndefined();
    expect(await skillSource("team_b").readDirectory!("skill://team-guide", {}, CTX)).toBe(
      undefined
    );
  });
});
