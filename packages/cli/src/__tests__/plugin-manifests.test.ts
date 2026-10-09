import { describe, test, expect } from "vitest";
import { access, readdir, readFile, stat } from "fs/promises";
import { isAbsolute, join, extname } from "path";
import Ajv from "ajv";
import addFormats from "ajv-formats";

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..", "..");
const CURSOR_PLUGIN = "plugins/cursor/context7";
const CURSOR_MARKETPLACE = ".cursor-plugin/marketplace.json";
const SCHEMA_DIR = join(import.meta.dirname, "fixtures", "cursor-plugin");

async function readJson<T>(relPath: string): Promise<T> {
  return JSON.parse(await readFile(join(REPO_ROOT, relPath), "utf-8")) as T;
}

/**
 * Validates `data` against a schema vendored from github.com/cursor/plugins
 * (schemas/*.schema.json). The copies live next to the tests so CI never
 * reaches for the network; refresh them when Cursor publishes a new schema.
 */
async function validateAgainst(schemaFile: string, data: unknown): Promise<string[]> {
  const schema = JSON.parse(await readFile(join(SCHEMA_DIR, schemaFile), "utf-8"));
  const ajv = new Ajv({ allErrors: true });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  if (validate(data)) return [];
  return (validate.errors ?? []).map((e) => `${e.instancePath || "/"} ${e.message ?? ""}`.trim());
}

function parseFrontmatter(markdown: string): Record<string, string> | undefined {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return undefined;
  const fields: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator === -1) continue;
    fields[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }
  return fields;
}

type CursorPluginManifest = {
  name: string;
  version?: string;
  logo?: string;
  skills?: string | string[];
  rules?: string | string[];
  agents?: string | string[];
  commands?: string | string[];
  hooks?: string | object;
  mcpServers?: string | object | Array<string | object>;
};

type CursorMarketplace = {
  name: string;
  plugins: Array<{ name: string; source: string }>;
};

describe("plugin MCP manifests", () => {
  test("Claude sends no Authorization header so OAuth can run", async () => {
    const relPath = "plugins/claude/context7/.mcp.json";
    const raw = await readFile(join(REPO_ROOT, relPath), "utf-8");
    const config = JSON.parse(raw) as {
      mcpServers: { context7: Record<string, unknown> };
    };
    expect(config.mcpServers.context7).toEqual({
      type: "http",
      url: "https://mcp.context7.com/mcp?client=claude-code-plugin",
    });
  });

  test("Copilot passes the raw API key via Authorization", async () => {
    const raw = await readFile(join(REPO_ROOT, "plugins/copilot/context7/.mcp.json"), "utf-8");
    const config = JSON.parse(raw) as {
      mcpServers: { context7: { headers: Record<string, string> } };
    };
    expect(config.mcpServers.context7.headers).toEqual({
      Authorization: "${CONTEXT7_API_KEY:-}",
    });
  });

  test("Cursor uses the mcpServers wrapper and the OAuth route", async () => {
    // Cursor reads mcp.json in the same shape as ~/.cursor/mcp.json; a bare
    // { context7: {...} } object is silently ignored, so the plugin would
    // install with no MCP server at all.
    const config = await readJson<{ mcpServers: Record<string, unknown> }>(
      `${CURSOR_PLUGIN}/mcp.json`
    );
    expect(Object.keys(config)).toEqual(["mcpServers"]);
    expect(config.mcpServers).toEqual({
      context7: { type: "http", url: "https://mcp.context7.com/mcp/oauth" },
    });
  });

  test("Cursor plugin names a skill it actually ships", async () => {
    const relPath = `${CURSOR_PLUGIN}/rules/use-context7.mdc`;
    const rule = await readFile(join(REPO_ROOT, relPath), "utf-8");
    const readme = await readFile(join(REPO_ROOT, `${CURSOR_PLUGIN}/README.md`), "utf-8");
    const shipped = (await readdir(join(REPO_ROOT, `${CURSOR_PLUGIN}/skills`))).sort();

    // Both files point the reader at a skill by name; a rename that misses one
    // of them leaves a dangling reference the agent cannot resolve.
    for (const [file, content] of [
      [relPath, rule],
      [`${CURSOR_PLUGIN}/README.md`, readme],
    ] as const) {
      const reference = content.match(/`(context7-[a-z0-9-]+)` skill/)?.[1];
      expect(reference, `${file} should reference a skill by name`).toBeDefined();
      expect(shipped, `${file} references "${reference}"`).toContain(reference);
    }
  });

  test("Cursor plugin's skill directories all contain a SKILL.md", async () => {
    const dir = join(REPO_ROOT, `${CURSOR_PLUGIN}/skills`);
    for (const entry of await readdir(dir)) {
      await expect(access(join(dir, entry, "SKILL.md"))).resolves.toBeUndefined();
    }
  });
});

describe("Cursor plugin manifests", () => {
  test("plugin.json lives where Cursor looks and validates against the plugin schema", async () => {
    // Cursor only discovers `.cursor-plugin/plugin.json`; the manifest used to
    // sit in `.cursor/`, which is why the marketplace listing fell back to
    // installing the Claude plugin instead.
    await expect(
      access(join(REPO_ROOT, CURSOR_PLUGIN, ".cursor", "plugin.json"))
    ).rejects.toThrow();

    const manifest = await readJson<CursorPluginManifest>(
      `${CURSOR_PLUGIN}/.cursor-plugin/plugin.json`
    );
    expect(await validateAgainst("plugin.schema.json", manifest)).toEqual([]);
    expect(manifest.name).toBe("context7");
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test("marketplace.json validates against the marketplace schema", async () => {
    const marketplace = await readJson<CursorMarketplace>(CURSOR_MARKETPLACE);
    expect(await validateAgainst("marketplace.schema.json", marketplace)).toEqual([]);
  });

  test("marketplace entries resolve to a plugin whose manifest name matches", async () => {
    const marketplace = await readJson<CursorMarketplace>(CURSOR_MARKETPLACE);
    const names = marketplace.plugins.map((p) => p.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain("context7");

    for (const entry of marketplace.plugins) {
      expect(isAbsolute(entry.source), `${entry.name} source must be relative`).toBe(false);
      expect(entry.source, `${entry.name} source must stay inside the repo`).not.toContain("..");
      const manifest = await readJson<CursorPluginManifest>(
        join(entry.source, ".cursor-plugin", "plugin.json")
      );
      expect(manifest.name).toBe(entry.name);
    }
  });

  test("every path the plugin manifest declares resolves inside the plugin", async () => {
    const manifest = await readJson<CursorPluginManifest>(
      `${CURSOR_PLUGIN}/.cursor-plugin/plugin.json`
    );
    const declared: Array<[string, string]> = [];
    const push = (field: string, value: unknown) => {
      if (typeof value === "string") declared.push([field, value]);
      else if (Array.isArray(value))
        value.forEach((v) => typeof v === "string" && declared.push([field, v]));
    };
    for (const field of ["logo", "skills", "rules", "agents", "commands", "hooks", "mcpServers"]) {
      push(field, manifest[field as keyof CursorPluginManifest]);
    }
    // The submission checklist wants a repository-hosted logo, so an external
    // URL counts as a regression even though the schema allows one.
    expect(declared.map(([field]) => field)).toContain("logo");

    for (const [field, value] of declared) {
      expect(value, `${field} must not be a URL`).not.toMatch(/^[a-z]+:\/\//);
      expect(isAbsolute(value), `${field} must be relative`).toBe(false);
      expect(value, `${field} must not escape the plugin`).not.toContain("..");
      await expect(
        access(join(REPO_ROOT, CURSOR_PLUGIN, value)),
        `${field} points at ${value}, which does not exist`
      ).resolves.toBeUndefined();
    }
  });

  test("skills, rules and agents carry the frontmatter Cursor requires", async () => {
    const root = join(REPO_ROOT, CURSOR_PLUGIN);

    for (const skill of await readdir(join(root, "skills"))) {
      const file = join("skills", skill, "SKILL.md");
      const fm = parseFrontmatter(await readFile(join(root, file), "utf-8"));
      expect(fm?.name, `${file} needs a name`).toBe(skill);
      expect(fm?.description, `${file} needs a description`).toBeTruthy();
    }

    const rules = await readdir(join(root, "rules"));
    expect(rules.length).toBeGreaterThan(0);
    for (const rule of rules) {
      const file = join("rules", rule);
      expect([".mdc", ".md"], `${file} must be .mdc or .md`).toContain(extname(rule));
      const fm = parseFrontmatter(await readFile(join(root, file), "utf-8"));
      expect(fm?.description, `${file} needs a description`).toBeTruthy();
      expect(["true", "false"], `${file} needs alwaysApply`).toContain(fm?.alwaysApply);
    }

    const agents = await readdir(join(root, "agents"));
    expect(agents.length).toBeGreaterThan(0);
    for (const agent of agents) {
      const file = join("agents", agent);
      expect(extname(agent), `${file} must be markdown`).toBe(".md");
      const fm = parseFrontmatter(await readFile(join(root, file), "utf-8"));
      expect(fm?.name, `${file} needs a name`).toBeTruthy();
      expect(fm?.description, `${file} needs a description`).toBeTruthy();
    }
  });

  test("plugin README documents install, local testing and the shipped components", async () => {
    const readme = await readFile(join(REPO_ROOT, CURSOR_PLUGIN, "README.md"), "utf-8");
    expect(readme).toContain("~/.cursor/plugins/local");
    expect(readme).toContain(".cursor-plugin/plugin.json");
    for (const component of ["mcp.json", "rules/", "skills/", "agents/"]) {
      expect(readme, `README should mention ${component}`).toContain(component);
    }
    expect((await stat(join(REPO_ROOT, CURSOR_PLUGIN, "assets/logo.svg"))).size).toBeGreaterThan(0);
  });
});
