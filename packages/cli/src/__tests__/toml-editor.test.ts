import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { patchTomlStdioApiKey } from "../setup/toml-editor.js";

const PACKAGE = "@upstash/context7-mcp";

interface RotationCase {
  name: string;
  source: string;
  oldToken: string;
}

const rotation = (name: string, source: string, oldToken = '"OLD"'): RotationCase => ({
  name,
  source,
  oldToken,
});

const rotations: RotationCase[] = [
  rotation(
    "single-line array",
    `[mcp_servers.context7]\ncommand = "npx"\nargs = ["-y", "${PACKAGE}@latest", "--api-key", "OLD"]\n`
  ),
  rotation(
    "multiline array with trailing comma",
    `[mcp_servers.context7]\nargs = [\n  "-y",\n  "${PACKAGE}@latest",\n  "--api-key",\n  "OLD",\n]\n`
  ),
  rotation(
    "multiline array without trailing comma",
    `[mcp_servers.context7]\nargs = [\n  "${PACKAGE}",\n  "--api-key",\n  "OLD"\n]\n`
  ),
  rotation("CRLF input", `[mcp_servers.context7]\r\nargs = ["${PACKAGE}", "--api-key", "OLD"]\r\n`),
  rotation(
    "literal API key",
    `[mcp_servers.context7]\nargs = ["${PACKAGE}", "--api-key", 'OLD']\n`,
    "'OLD'"
  ),
  rotation(
    "quoted server key",
    `[mcp_servers."context7"]\nargs = ["${PACKAGE}", "--api-key", "OLD"]\n`
  ),
  rotation(
    "fully quoted table path",
    `["mcp_servers"."context7"]\nargs = ["${PACKAGE}", "--api-key", "OLD"]\n`
  ),
  rotation(
    "spaced dotted table path",
    `[ mcp_servers . context7 ]\nargs = ["${PACKAGE}", "--api-key", "OLD"]\n`
  ),
  rotation(
    "UTF-8 BOM",
    `\uFEFF[mcp_servers.context7]\nargs = ["${PACKAGE}", "--api-key", "OLD"]\n`
  ),
  rotation(
    "quoted args key",
    `[mcp_servers.context7]\n"args" = ["${PACKAGE}", "--api-key", "OLD"]\n`
  ),
  rotation(
    "literal args key",
    `[mcp_servers.context7]\n'args' = ["${PACKAGE}", "--api-key", "OLD"]\n`
  ),
  rotation(
    "table header trailing comment",
    `[mcp_servers.context7] # docs\nargs = ["${PACKAGE}", "--api-key", "OLD"]\n`
  ),
  rotation(
    "tab indentation",
    `[mcp_servers.context7]\nargs\t=\t[\n\t"${PACKAGE}",\n\t"--api-key",\n\t"OLD"\n]\n`
  ),
  rotation(
    "pinned package version",
    `[mcp_servers.context7]\nargs = ["${PACKAGE}@0.6.0", "--api-key", "OLD"]\n`
  ),
  rotation(
    "unversioned package",
    `[mcp_servers.context7]\nargs = ["${PACKAGE}", "--api-key", "OLD"]\n`
  ),
  rotation(
    "flags around API key",
    `[mcp_servers.context7]\nargs = ["-y", "${PACKAGE}", "--transport", "stdio", "--api-key", "OLD", "--debug"]\n`
  ),
  rotation(
    "comments between every item",
    `[mcp_servers.context7]\nargs = [\n  "${PACKAGE}", # package\n  "--api-key", # flag\n  "OLD", # value\n]\n`
  ),
  rotation(
    "Unicode escape in old key",
    `[mcp_servers.context7]\nargs = ["${PACKAGE}", "--api-key", "OLD\\u0021"]\n`,
    '"OLD\\u0021"'
  ),
  rotation(
    "escaped backslash in old key",
    `[mcp_servers.context7]\nargs = ["${PACKAGE}", "--api-key", "OLD\\\\KEY"]\n`,
    '"OLD\\\\KEY"'
  ),
  rotation(
    "Unicode package escape",
    `[mcp_servers.context7]\nargs = ["@upstash/context7-mcp\\u0040latest", "--api-key", "OLD"]\n`
  ),
];

interface MutationCase {
  name: string;
  args: string;
  apiKey: string | undefined;
  expectedArgs: string;
}

const mutations: MutationCase[] = [
  {
    name: "adds a key",
    args: `["${PACKAGE}"]`,
    apiKey: "NEW",
    expectedArgs: `["${PACKAGE}","--api-key","NEW"]`,
  },
  {
    name: "adds a key to multiline args",
    args: `[\n  "-y",\n  "${PACKAGE}@latest",\n]`,
    apiKey: "NEW",
    expectedArgs: `["-y","${PACKAGE}@latest","--api-key","NEW"]`,
  },
  {
    name: "removes a key",
    args: `["${PACKAGE}", "--api-key", "OLD"]`,
    apiKey: undefined,
    expectedArgs: `["${PACKAGE}"]`,
  },
  {
    name: "removes a literal key",
    args: `['${PACKAGE}', '--api-key', 'OLD']`,
    apiKey: undefined,
    expectedArgs: `["${PACKAGE}"]`,
  },
  {
    name: "normalizes duplicate keys",
    args: `["${PACKAGE}", "--api-key", "A", "--api-key", "B"]`,
    apiKey: "NEW",
    expectedArgs: `["${PACKAGE}","--api-key","NEW"]`,
  },
  {
    name: "removes duplicate keys",
    args: `["${PACKAGE}", "--api-key", "A", "--api-key", "B"]`,
    apiKey: undefined,
    expectedArgs: `["${PACKAGE}"]`,
  },
  {
    name: "repairs a dangling key",
    args: `["${PACKAGE}", "--api-key"]`,
    apiKey: "NEW",
    expectedArgs: `["${PACKAGE}","--api-key","NEW"]`,
  },
  {
    name: "removes a dangling key",
    args: `["${PACKAGE}", "--api-key"]`,
    apiKey: undefined,
    expectedArgs: `["${PACKAGE}"]`,
  },
  {
    name: "preserves an already-current key",
    args: `["${PACKAGE}", "--api-key", "NEW"]`,
    apiKey: "NEW",
    expectedArgs: `["${PACKAGE}", "--api-key", "NEW"]`,
  },
  {
    name: "preserves flags while adding a key",
    args: `["-y", "${PACKAGE}", "--debug"]`,
    apiKey: "NEW",
    expectedArgs: `["-y","${PACKAGE}","--debug","--api-key","NEW"]`,
  },
];

const preservationVariants = [
  { name: "working directory", suffix: `cwd = "/custom"\n` },
  { name: "inline environment", suffix: `env = { FOO = "bar" }\n` },
  { name: "environment subtable", suffix: `[mcp_servers.context7.env]\nFOO = "bar"\n` },
  {
    name: "HTTP headers subtable",
    suffix: `[mcp_servers.context7.http_headers]\nX_TRACE = "enabled"\n`,
  },
  {
    name: "following MCP server",
    suffix: `[mcp_servers.filesystem]\ncommand = "uvx"\nargs = ["server-filesystem", "/tmp"]\n`,
  },
  { name: "following unrelated table", suffix: `[profiles.work]\nmodel = "gpt-5"\n` },
  { name: "comments and blank lines", suffix: `# retain this comment\n\n` },
  { name: "server options", suffix: `enabled = true\nstartup_timeout_sec = 30\n` },
  { name: "TOML-looking string content", suffix: `env = { LABEL = "[global],#literal" }\n` },
  {
    name: "CRLF following server",
    suffix: `\r\n[mcp_servers.other]\r\nurl = "https://example.com"\r\n`,
  },
] as const;

interface OptionalSourceCase {
  name: string;
  source?: string;
}

interface SourceCase {
  name: string;
  source: string;
}

const absentTargets: OptionalSourceCase[] = [
  { name: "missing file" },
  { name: "empty file", source: "" },
  { name: "different server", source: `[mcp_servers.other]\nargs = ["${PACKAGE}"]\n` },
  {
    name: "similar server name",
    source: `[mcp_servers.context70]\nargs = ["${PACKAGE}", "--api-key", "OLD"]\n`,
  },
];

const unsafeTargets: SourceCase[] = [
  { name: "HTTP server", source: `[mcp_servers.context7]\nurl = "https://mcp.context7.com/mcp"\n` },
  {
    name: "quoted HTTP server",
    source: `[mcp_servers."context7"]\nurl = "https://mcp.context7.com/mcp"\n`,
  },
  {
    name: "different package",
    source: `[mcp_servers.context7]\nargs = ["other-package", "--api-key", "OLD"]\n`,
  },
  {
    name: "package only in comment",
    source: `[mcp_servers.context7]\nargs = ["other-package"] # ${PACKAGE}\n`,
  },
  {
    name: "package name with suffix",
    source: `[mcp_servers.context7]\nargs = ["${PACKAGE}-lookalike", "--api-key", "OLD"]\n`,
  },
  {
    name: "package name with prefix",
    source: `[mcp_servers.context7]\nargs = ["evil-${PACKAGE}", "--api-key", "OLD"]\n`,
  },
  {
    name: "package belongs to another server",
    source: `[mcp_servers.context7]\nargs = ["other-package"]\n\n[mcp_servers.other]\nargs = ["${PACKAGE}"]\n`,
  },
  {
    name: "target table and args inside a multiline string",
    source: `description = """
[mcp_servers.context7]
args = ["${PACKAGE}", "--api-key", "DECOY"]
[not-a-real-table]
"""
[mcp_servers.context7]
args = ["${PACKAGE}", "--api-key", "REAL"]
`,
  },
];

const invalidArgs = [
  { name: "number", value: `["${PACKAGE}", 42]` },
  { name: "boolean", value: `["${PACKAGE}", true]` },
  { name: "inline table", value: `["${PACKAGE}", { key = "value" }]` },
  { name: "nested array", value: `["${PACKAGE}", ["nested"]]` },
  { name: "unterminated array", value: `["${PACKAGE}"` },
  { name: "unterminated basic string", value: `["${PACKAGE}", "broken]` },
  { name: "unsupported escape", value: `["${PACKAGE}", "bad\\x"]` },
  { name: "invalid Unicode escape", value: `["${PACKAGE}", "bad\\u12ZZ"]` },
  { name: "multiline basic string", value: `["${PACKAGE}", "line\nbreak"]` },
  { name: "missing args", value: null },
] as const;

const CONFIG_COUNT =
  rotations.length +
  mutations.length +
  preservationVariants.length +
  absentTargets.length +
  unsafeTargets.length +
  invalidArgs.length;
if (CONFIG_COUNT !== 62) throw new Error(`Expected 62 TOML fixtures, received ${CONFIG_COUNT}`);

describe("patchTomlStdioApiKey 62-config compatibility matrix", () => {
  let tempDir: string;
  let configPath: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "ctx7-toml-editor-"));
    configPath = join(tempDir, "config.toml");
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test.each(rotations)("rotates API key: $name", async ({ source, oldToken }) => {
    await writeFile(configPath, source, "utf-8");

    expect(await patchTomlStdioApiKey(configPath, "context7", "NEW")).toBe(true);
    expect(await readFile(configPath, "utf-8")).toBe(source.replace(oldToken, '"NEW"'));
  });

  test.each(mutations)("changes API key shape: $name", async ({ args, apiKey, expectedArgs }) => {
    const source = `[mcp_servers.context7]\ncommand = "npx"\nargs = ${args}\ncwd = "/keep"\n`;
    await writeFile(configPath, source, "utf-8");

    expect(await patchTomlStdioApiKey(configPath, "context7", apiKey)).toBe(true);
    expect(await readFile(configPath, "utf-8")).toBe(
      `[mcp_servers.context7]\ncommand = "npx"\nargs = ${expectedArgs}\ncwd = "/keep"\n`
    );
  });

  test.each(preservationVariants)(
    "preserves surrounding TOML byte-for-byte: $name",
    async ({ suffix }) => {
      const lineEnding = suffix.includes("\r\n") ? "\r\n" : "\n";
      const source = `model = "gpt-5"${lineEnding}[mcp_servers.context7]${lineEnding}args = ["${PACKAGE}", "--api-key", "OLD"]${lineEnding}${suffix}`;
      await writeFile(configPath, source, "utf-8");

      expect(await patchTomlStdioApiKey(configPath, "context7", "NEW")).toBe(true);
      expect(await readFile(configPath, "utf-8")).toBe(source.replace('"OLD"', '"NEW"'));
    }
  );

  test.each(absentTargets)(
    "leaves configs without the target unchanged: $name",
    async ({ source }) => {
      if (source !== undefined) await writeFile(configPath, source, "utf-8");

      expect(await patchTomlStdioApiKey(configPath, "context7", "NEW")).toBe(false);
      if (source !== undefined) expect(await readFile(configPath, "utf-8")).toBe(source);
    }
  );

  test.each(unsafeTargets)(
    "fails closed for an unsafe existing target: $name",
    async ({ source }) => {
      await writeFile(configPath, source, "utf-8");

      await expect(patchTomlStdioApiKey(configPath, "context7", "NEW")).rejects.toThrow();
      expect(await readFile(configPath, "utf-8")).toBe(source);
    }
  );

  test.each(invalidArgs)("fails closed: $name", async ({ value }) => {
    const source =
      value === null
        ? `[mcp_servers.context7]\ncommand = "custom-wrapper"\n`
        : `[mcp_servers.context7]\ncommand = "npx"\nargs = ${value}\n`;
    await writeFile(configPath, source, "utf-8");

    await expect(patchTomlStdioApiKey(configPath, "context7", "NEW")).rejects.toThrow();
    expect(await readFile(configPath, "utf-8")).toBe(source);
  });
});
