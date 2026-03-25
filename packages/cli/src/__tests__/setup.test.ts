import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdir, readFile, writeFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

const MOCK_MCP_RULE = "Use Context7 MCP to fetch docs.\n";
const MOCK_CLI_RULE = "Use the `ctx7` CLI to fetch docs.\n";

vi.stubGlobal(
  "fetch",
  vi.fn((url: string) => {
    if (url.includes("context7-mcp.md")) {
      return Promise.resolve({ ok: true, text: () => Promise.resolve(MOCK_MCP_RULE) });
    }
    if (url.includes("context7-cli.md")) {
      return Promise.resolve({ ok: true, text: () => Promise.resolve(MOCK_CLI_RULE) });
    }
    return Promise.resolve({ ok: false });
  })
);

import { getRuleContent } from "../setup/templates.js";
import {
  mergeServerEntry,
  mergeInstructions,
  readJsonConfig,
  writeJsonConfig,
} from "../setup/mcp-writer.js";

describe("getRuleContent", () => {
  test("returns correct content per mode", async () => {
    expect(await getRuleContent("mcp", "claude")).toBe(MOCK_MCP_RULE);
    expect(await getRuleContent("cli", "claude")).toBe(MOCK_CLI_RULE);
  });

  test("only cursor gets alwaysApply frontmatter", async () => {
    const cursor = await getRuleContent("mcp", "cursor");
    expect(cursor).toContain("---\nalwaysApply: true\n---");
    expect(cursor).toContain(MOCK_MCP_RULE);

    for (const agent of ["claude", "codex", "opencode"]) {
      const content = await getRuleContent("mcp", agent);
      expect(content).not.toContain("alwaysApply");
    }
  });

  test("throws when all fetch URLs fail", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ ok: false }))
    );
    await expect(getRuleContent("mcp", "claude")).rejects.toThrow("Failed to fetch rule");

    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (url.includes("context7-mcp.md"))
          return Promise.resolve({ ok: true, text: () => Promise.resolve(MOCK_MCP_RULE) });
        if (url.includes("context7-cli.md"))
          return Promise.resolve({ ok: true, text: () => Promise.resolve(MOCK_CLI_RULE) });
        return Promise.resolve({ ok: false });
      })
    );
  });
});

describe("mergeServerEntry", () => {
  test("adds server to empty config", () => {
    const { config, alreadyExists } = mergeServerEntry({}, "mcpServers", "context7", {
      url: "https://mcp.context7.com/mcp",
    });
    expect(alreadyExists).toBe(false);
    expect((config.mcpServers as Record<string, unknown>).context7).toEqual({
      url: "https://mcp.context7.com/mcp",
    });
  });

  test("preserves existing servers when adding new one", () => {
    const { config } = mergeServerEntry(
      { mcpServers: { other: { url: "https://other.com" } } },
      "mcpServers",
      "context7",
      { url: "https://mcp.context7.com/mcp" }
    );
    const servers = config.mcpServers as Record<string, unknown>;
    expect(servers.context7).toBeTruthy();
    expect(servers.other).toEqual({ url: "https://other.com" });
  });

  test("does not overwrite existing server", () => {
    const existing = { mcpServers: { context7: { url: "https://old.com" } } };
    const { config, alreadyExists } = mergeServerEntry(existing, "mcpServers", "context7", {
      url: "https://new.com",
    });
    expect(alreadyExists).toBe(true);
    expect(config).toBe(existing);
  });

  test("works with opencode configKey 'mcp'", () => {
    const { config } = mergeServerEntry({}, "mcp", "context7", {
      type: "remote",
      url: "https://mcp.context7.com/mcp",
    });
    expect((config.mcp as Record<string, unknown>).context7).toEqual({
      type: "remote",
      url: "https://mcp.context7.com/mcp",
    });
  });
});

describe("mergeInstructions", () => {
  test("adds and deduplicates globs", () => {
    const empty = mergeInstructions({}, ".opencode/rules/*.md");
    expect(empty.instructions).toEqual([".opencode/rules/*.md"]);

    const appended = mergeInstructions({ instructions: ["existing.md"] }, ".opencode/rules/*.md");
    expect(appended.instructions).toEqual(["existing.md", ".opencode/rules/*.md"]);

    const config = { instructions: [".opencode/rules/*.md"] };
    expect(mergeInstructions(config, ".opencode/rules/*.md")).toBe(config);
  });
});

describe("readJsonConfig / writeJsonConfig", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `ctx7-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test("returns empty object for missing or empty file", async () => {
    expect(await readJsonConfig(join(tempDir, "nope.json"))).toEqual({});

    await writeFile(join(tempDir, "empty.json"), "", "utf-8");
    expect(await readJsonConfig(join(tempDir, "empty.json"))).toEqual({});
  });

  test("roundtrip write then read preserves data", async () => {
    const path = join(tempDir, "sub", "dir", "config.json");
    const data = { mcpServers: { context7: { url: "https://mcp.context7.com/mcp" } } };

    await writeJsonConfig(path, data);
    const result = await readJsonConfig(path);
    expect(result).toEqual(data);

    const raw = await readFile(path, "utf-8");
    expect(raw.endsWith("\n")).toBe(true);
  });
});

describe("AGENTS.md append", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `ctx7-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  const marker = "<!-- context7 -->";
  const ruleContent = "Use ctx7 CLI for docs.\n";

  async function appendRule(filePath: string, existing?: string): Promise<string> {
    if (existing !== undefined) {
      await writeFile(filePath, existing, "utf-8");
    }

    const escapedMarker = marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const section = `${marker}\n${ruleContent}${marker}`;

    let content = "";
    try {
      content = await readFile(filePath, "utf-8");
    } catch {
      // doesn't exist
    }

    if (content.includes(marker)) {
      const regex = new RegExp(`${escapedMarker}\\n[\\s\\S]*?${escapedMarker}`);
      await writeFile(filePath, content.replace(regex, section), "utf-8");
    } else {
      const separator =
        content.length > 0 && !content.endsWith("\n") ? "\n\n" : content.length > 0 ? "\n" : "";
      await mkdir(join(filePath, ".."), { recursive: true });
      await writeFile(filePath, content + separator + section + "\n", "utf-8");
    }

    return readFile(filePath, "utf-8");
  }

  test("creates new file cleanly", async () => {
    const result = await appendRule(join(tempDir, "AGENTS.md"));
    expect(result).toBe(`${marker}\n${ruleContent}${marker}\n`);
    expect(result[0]).not.toBe("\n");
  });

  test("appends to existing content with proper spacing", async () => {
    const withNewline = await appendRule(join(tempDir, "a.md"), "# Rules\n");
    expect(withNewline).toContain("# Rules\n\n<!-- context7 -->");

    const withoutNewline = await appendRule(join(tempDir, "b.md"), "No trailing newline");
    expect(withoutNewline).toContain("No trailing newline\n\n<!-- context7 -->");
  });

  test("is idempotent on re-run", async () => {
    const filePath = join(tempDir, "AGENTS.md");
    const first = await appendRule(filePath);
    const second = await appendRule(filePath);
    expect(second).toBe(first);
    expect(second.match(/<!-- context7 -->/g)?.length).toBe(2);
  });

  test("replaces section without affecting surrounding content", async () => {
    const filePath = join(tempDir, "AGENTS.md");
    await writeFile(filePath, `# Before\n\n${marker}\nold content\n${marker}\n\n# After\n`);

    const result = await appendRule(filePath);
    expect(result).toContain("# Before");
    expect(result).toContain("# After");
    expect(result).not.toContain("old content");
    expect(result).toContain(ruleContent);
  });
});
