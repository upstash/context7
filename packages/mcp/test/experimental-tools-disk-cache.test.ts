import { chmod, mkdtemp, mkdir, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const KEY = "ctx7sk-disk-cache-secret";
const OTHER_KEY = "ctx7sk-other-user-secret";
const FIVE_MINUTES = 5 * 60_000;
const posixOnly = process.platform === "win32" ? test.skip : test;

const fetchMock = vi.fn<typeof fetch>();
const choice = (tools: string[]) =>
  new Response(JSON.stringify({ all: false, tools }), {
    headers: { "content-type": "application/json" },
  });

let root: string;
const directory = () => join(root, "context7", "mcp-experimental-tools");
const entries = async () => readdir(directory()).catch(() => [] as string[]);

/** A new import has an empty memory cache, as a new stdio process does. */
async function newProcessLookup(apiKey = KEY, transport: "stdio" | "http" = "stdio") {
  vi.resetModules();
  const { fetchExperimentalTools } = await import("../src/lib/api.js");
  return fetchExperimentalTools({ apiKey, transport }, () => {});
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "context7-disk-cache-"));
  vi.stubEnv("XDG_CACHE_HOME", root);
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => choice(["query-code"]));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await chmod(root, 0o700).catch(() => {});
  await rm(root, { recursive: true, force: true });
});

describe("experimental tools disk cache", () => {
  test("a new stdio process reuses the answer without calling the API", async () => {
    expect(await newProcessLookup()).toEqual(["code-tools"]);
    expect(await newProcessLookup()).toEqual(["code-tools"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("caches the common answer that no tool is on", async () => {
    fetchMock.mockImplementation(async () => choice([]));
    expect(await newProcessLookup()).toEqual([]);
    expect(await newProcessLookup()).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("a credential never reads the entry of another credential", async () => {
    await newProcessLookup(KEY);
    fetchMock.mockImplementation(async () => choice([]));
    expect(await newProcessLookup(OTHER_KEY)).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(await entries()).toHaveLength(2);
  });

  test("stores neither the token nor the hash the app keeps for it", async () => {
    await newProcessLookup();
    const [name] = await entries();
    const content = await readFile(join(directory(), name), "utf8");
    const appHash = createHash("sha256").update(KEY).digest("hex");
    for (const text of [name, content]) {
      expect(text).not.toContain(KEY);
      expect(text).not.toContain(appHash);
    }
    expect(Object.keys(JSON.parse(content)).sort()).toEqual(["storedAt", "tools", "version"]);
  });

  posixOnly("creates a private directory and private files, with no leftovers", async () => {
    const { stat } = await import("node:fs/promises");
    await newProcessLookup();
    const files = await entries();
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^[0-9a-f]{64}\.json$/);
    expect((await stat(directory())).mode & 0o777).toBe(0o700);
    expect((await stat(join(directory(), files[0]))).mode & 0o777).toBe(0o600);
  });

  test("asks again once the entry is 5 minutes old, so a dashboard change shows", async () => {
    const start = Date.now();
    const now = vi.spyOn(Date, "now").mockReturnValue(start);
    fetchMock.mockImplementationOnce(async () => choice([]));
    expect(await newProcessLookup()).toEqual([]);

    now.mockReturnValue(start + FIVE_MINUTES - 1);
    expect(await newProcessLookup()).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    now.mockReturnValue(start + FIVE_MINUTES);
    expect(await newProcessLookup()).toEqual(["code-tools"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("ignores an entry from the future", async () => {
    const start = Date.now();
    const now = vi.spyOn(Date, "now").mockReturnValue(start + 3_600_000);
    await newProcessLookup();
    now.mockReturnValue(start);
    await newProcessLookup();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("does not keep a failed lookup", async () => {
    fetchMock.mockImplementationOnce(async () => new Response(null, { status: 503 }));
    expect(await newProcessLookup()).toEqual([]);
    expect(await entries()).toEqual([]);
    expect(await newProcessLookup()).toEqual(["code-tools"]);
  });

  test("an HTTP server does not use the disk", async () => {
    await newProcessLookup(KEY, "http");
    expect(await entries()).toEqual([]);
  });

  test("a damaged entry means a normal lookup, which replaces it", async () => {
    await newProcessLookup();
    const [name] = await entries();
    await writeFile(join(directory(), name), "{not json", { mode: 0o600 });
    expect(await newProcessLookup()).toEqual(["code-tools"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(await readFile(join(directory(), name), "utf8")).version).toBe(1);
  });

  posixOnly("ignores an entry that others can read", async () => {
    await newProcessLookup();
    const [name] = await entries();
    await chmod(join(directory(), name), 0o644);
    await newProcessLookup();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  posixOnly("does not follow a symbolic link at the entry's path", async () => {
    await newProcessLookup();
    const [name] = await entries();
    const path = join(directory(), name);
    const elsewhere = join(root, "elsewhere.json");
    await writeFile(elsewhere, await readFile(path), { mode: 0o600 });
    await rm(path);
    await symlink(elsewhere, path);
    await newProcessLookup();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  posixOnly("does not write into a directory that others can open", async () => {
    await mkdir(directory(), { recursive: true, mode: 0o755 });
    await chmod(directory(), 0o755);
    expect(await newProcessLookup()).toEqual(["code-tools"]);
    expect(await entries()).toEqual([]);
  });

  posixOnly("works on a read-only file system", async () => {
    await chmod(root, 0o500);
    expect(await newProcessLookup()).toEqual(["code-tools"]);
    expect(await newProcessLookup()).toEqual(["code-tools"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
