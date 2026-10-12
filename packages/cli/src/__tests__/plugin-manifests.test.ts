import { describe, test, expect } from "vitest";
import { access, readdir, readFile, stat } from "fs/promises";
import { basename, extname, isAbsolute, join } from "path";
import Ajv from "ajv";
import addFormats from "ajv-formats";

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..", "..");
const CURSOR_PLUGIN = "plugins/cursor/context7";
const CURSOR_SCHEMAS = join(import.meta.dirname, "fixtures", "cursor");

const KEBAB_CASE = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/;
const MARKDOWN = [".md", ".mdc", ".markdown"];

async function readJson<T>(relPath: string): Promise<T> {
  return JSON.parse(await readFile(join(REPO_ROOT, relPath), "utf-8")) as T;
}

// Vendored copies of github.com/cursor/plugins/schemas/*.schema.json (draft-07).
// Validating offline keeps CI deterministic; refresh the fixtures when Cursor
// changes the format.
async function validator(schemaFile: string) {
  const schema = JSON.parse(await readFile(join(CURSOR_SCHEMAS, schemaFile), "utf-8"));
  const ajv = new Ajv({ allErrors: true, strict: true });
  addFormats(ajv);
  return ajv.compile(schema);
}

// Cursor's parser ships only `name` and `description`; a YAML dependency would
// be overkill for single-line `key: value` frontmatter.
function frontmatter(file: string, content: string): Record<string, string> {
  const block = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  expect(block, `${file} should start with a YAML frontmatter block`).not.toBeNull();
  const fields: Record<string, string> = {};
  for (const line of block![1].split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator > 0) {
      fields[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
    }
  }
  return fields;
}

// Cursor's submission checklist: "All paths in manifest are relative and valid
// (no `..`, no absolute paths)".
function expectRelative(field: string, value: string) {
  expect(isAbsolute(value), `${field} must be relative: ${value}`).toBe(false);
  expect(value.split(/[\\/]/), `${field} must not escape the plugin: ${value}`).not.toContain("..");
}

interface CursorManifest {
  name: string;
  version?: string;
  logo?: string;
  skills?: string;
  rules?: string;
  agents?: string;
  commands?: string;
  hooks?: string | object;
  mcpServers?: string | object;
}

interface CursorMarketplace {
  name: string;
  owner: { name: string };
  metadata?: { description?: string };
  plugins: { name: string; source: string; description?: string }[];
}

interface ClaudeMarketplace {
  name: string;
  owner: { name: string };
}

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

  test("Cursor uses the mcpServers map with an explicit http transport", async () => {
    // Cursor plugins read `{ mcpServers: { name: {...} } }` like the Claude
    // plugin, not the bare `{ name: {...} }` shape the plugin shipped with.
    // The OAuth endpoint is the one Cursor keys the token on; changing it
    // makes every installed user sign in again, so pin it.
    const config = await readJson<Record<string, unknown>>(`${CURSOR_PLUGIN}/mcp.json`);
    expect(config).toEqual({
      mcpServers: {
        context7: {
          type: "http",
          url: "https://mcp.context7.com/mcp/oauth",
        },
      },
    });
  });
});

describe("Cursor plugin manifest", () => {
  const manifestPath = `${CURSOR_PLUGIN}/.cursor-plugin/plugin.json`;

  test("lives at .cursor-plugin/plugin.json", async () => {
    // Cursor only recognises `.cursor-plugin/plugin.json`; the original plugin
    // (#1659) used `.cursor/plugin.json`, which Cursor ignores entirely.
    await expect(access(join(REPO_ROOT, manifestPath))).resolves.toBeUndefined();
  });

  test("validates against Cursor's plugin.schema.json", async () => {
    const validate = await validator("plugin.schema.json");
    const manifest = await readJson<CursorManifest>(manifestPath);
    expect(validate(manifest), JSON.stringify(validate.errors, null, 2)).toBe(true);
    expect(manifest.name).toBe("context7");
  });

  test("declared component paths are relative and resolve inside the plugin", async () => {
    const manifest = await readJson<CursorManifest>(manifestPath);
    const pathFields = [
      "logo",
      "skills",
      "rules",
      "agents",
      "commands",
      "hooks",
      "mcpServers",
    ] as const;

    for (const field of pathFields) {
      const value = manifest[field];
      if (typeof value !== "string") continue;
      expectRelative(field, value);
      await expect(
        access(join(REPO_ROOT, CURSOR_PLUGIN, value)),
        `${field} points at a missing path: ${value}`
      ).resolves.toBeUndefined();
    }

    // The marketplace listing should install the whole plugin, not just MCP.
    expect(manifest.skills).toBeDefined();
    expect(manifest.rules).toBeDefined();
    expect(manifest.agents).toBeDefined();
    expect(manifest.mcpServers).toBe("./mcp.json");
  });

  test("logo is committed to the repo and referenced by relative path", async () => {
    // Cursor resolves relative logo paths to raw.githubusercontent.com; an
    // external URL is accepted by the schema but fails the submission checklist.
    const manifest = await readJson<CursorManifest>(manifestPath);
    expect(manifest.logo).toBeDefined();
    expect(manifest.logo).not.toMatch(/^https?:\/\//);
    const size = (await stat(join(REPO_ROOT, CURSOR_PLUGIN, manifest.logo!))).size;
    expect(size).toBeGreaterThan(0);
  });
});

describe("Cursor plugin components", () => {
  // Mirrors the discovery rules in cursor.com/docs/reference/plugins and the
  // `review-plugin-submission` checklist in github.com/cursor/plugins.
  test("every skill directory has a SKILL.md with name and description", async () => {
    const manifest = await readJson<CursorManifest>(`${CURSOR_PLUGIN}/.cursor-plugin/plugin.json`);
    const dir = join(REPO_ROOT, CURSOR_PLUGIN, manifest.skills ?? "skills");
    const entries = await readdir(dir);
    expect(entries.length).toBeGreaterThan(0);

    for (const entry of entries) {
      const file = join(dir, entry, "SKILL.md");
      const fields = frontmatter(file, await readFile(file, "utf-8"));
      expect(fields.name, `${file} name`).toBe(entry);
      expect(fields.name).toMatch(KEBAB_CASE);
      expect(fields.description, `${file} description`).toBeTruthy();
    }
  });

  test("every rule has frontmatter with a description", async () => {
    const manifest = await readJson<CursorManifest>(`${CURSOR_PLUGIN}/.cursor-plugin/plugin.json`);
    const dir = join(REPO_ROOT, CURSOR_PLUGIN, manifest.rules ?? "rules");
    const files = (await readdir(dir)).filter((f) => MARKDOWN.includes(extname(f)));
    expect(files.length).toBeGreaterThan(0);

    for (const name of files) {
      const file = join(dir, name);
      const fields = frontmatter(file, await readFile(file, "utf-8"));
      expect(fields.description, `${file} description`).toBeTruthy();
      if ("alwaysApply" in fields) {
        expect(["true", "false"], `${file} alwaysApply`).toContain(fields.alwaysApply);
      }
    }
  });

  test("every agent has frontmatter with name and description", async () => {
    const manifest = await readJson<CursorManifest>(`${CURSOR_PLUGIN}/.cursor-plugin/plugin.json`);
    const dir = join(REPO_ROOT, CURSOR_PLUGIN, manifest.agents ?? "agents");
    const files = (await readdir(dir)).filter((f) => MARKDOWN.includes(extname(f)));
    expect(files.length).toBeGreaterThan(0);

    for (const name of files) {
      const file = join(dir, name);
      const fields = frontmatter(file, await readFile(file, "utf-8"));
      expect(fields.name, `${file} name`).toBe(basename(name, extname(name)));
      expect(fields.name).toMatch(KEBAB_CASE);
      expect(fields.description, `${file} description`).toBeTruthy();
    }
  });

  test("rule and README name a skill the plugin actually ships", async () => {
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
});

describe("Cursor marketplace manifest", () => {
  const marketplacePath = ".cursor-plugin/marketplace.json";

  test("validates against Cursor's marketplace.schema.json", async () => {
    const validate = await validator("marketplace.schema.json");
    const marketplace = await readJson<CursorMarketplace>(marketplacePath);
    expect(validate(marketplace), JSON.stringify(validate.errors, null, 2)).toBe(true);
  });

  test("every entry resolves to a Cursor plugin with a matching, unique name", async () => {
    const marketplace = await readJson<CursorMarketplace>(marketplacePath);
    expect(marketplace.plugins.length).toBeGreaterThan(0);

    const names = marketplace.plugins.map((p) => p.name);
    expect(new Set(names).size).toBe(names.length);

    for (const entry of marketplace.plugins) {
      expectRelative(`plugins[${entry.name}].source`, entry.source);
      const manifest = await readJson<CursorManifest>(
        join(entry.source, ".cursor-plugin", "plugin.json")
      );
      expect(manifest.name).toBe(entry.name);
    }
  });

  test("lists only the Cursor plugin under the same marketplace identity as Claude", async () => {
    // The listing on cursor.com indexes this file; keep the marketplace name
    // and owner in step with .claude-plugin/marketplace.json so both stores
    // show one brand. Descriptions are free to differ.
    const cursor = await readJson<CursorMarketplace>(marketplacePath);
    const claude = await readJson<ClaudeMarketplace>(".claude-plugin/marketplace.json");

    expect(cursor.plugins.map((p) => p.source)).toEqual([`./${CURSOR_PLUGIN}`]);
    expect(cursor.name).toBe(claude.name);
    expect(cursor.owner.name).toBe(claude.owner.name);
  });
});
