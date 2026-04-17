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
  removeServerEntry,
  readJsonConfig,
  writeJsonConfig,
  readTomlServerExists,
  buildTomlServerBlock,
  appendTomlServer,
  removeTomlServer,
  resolveMcpPath,
} from "../setup/mcp-writer.js";
import { getAgent, ALL_AGENT_NAMES, type AuthOptions } from "../setup/agents.js";

describe("getRuleContent", () => {
  test("returns correct content per mode", async () => {
    expect(await getRuleContent("mcp", "claude")).toBe(MOCK_MCP_RULE);
    expect(await getRuleContent("cli", "claude")).toBe(MOCK_CLI_RULE);
  });

  test("only cursor gets alwaysApply frontmatter", async () => {
    const cursor = await getRuleContent("mcp", "cursor");
    expect(cursor).toContain("---\nalwaysApply: true\n---");
    expect(cursor).toContain(MOCK_MCP_RULE);

    for (const agent of ["claude", "codex", "opencode", "gemini"]) {
      const content = await getRuleContent("mcp", agent);
      expect(content).not.toContain("alwaysApply");
    }
  });

  test("returns fallback content when all fetch URLs fail", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ ok: false }))
    );
    const content = await getRuleContent("mcp", "claude");
    expect(content).toContain("Context7 MCP");
    expect(content.length).toBeGreaterThan(100);

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

  test("overwrites existing server and flags alreadyExists", () => {
    const existing = { mcpServers: { context7: { url: "https://old.com" } } };
    const { config, alreadyExists } = mergeServerEntry(existing, "mcpServers", "context7", {
      url: "https://new.com",
    });
    expect(alreadyExists).toBe(true);
    expect((config.mcpServers as Record<string, unknown>).context7).toEqual({
      url: "https://new.com",
    });
  });

  test("overwrites existing server entry with new url", () => {
    const existing = {
      mcpServers: {
        context7: { url: "https://old.com", headers: { key: "old-key" } },
        other: { url: "https://other.com" },
      },
    };
    const { config, alreadyExists } = mergeServerEntry(existing, "mcpServers", "context7", {
      url: "https://mcp.context7.com/mcp",
      headers: { key: "new-key" },
    });
    expect(alreadyExists).toBe(true);
    const servers = config.mcpServers as Record<string, unknown>;
    expect(servers.context7).toEqual({
      url: "https://mcp.context7.com/mcp",
      headers: { key: "new-key" },
    });
    expect(servers.other).toEqual({ url: "https://other.com" });
  });

  test("overwrites existing server entry with different auth mode", () => {
    const existing = {
      mcpServers: {
        context7: { url: "https://mcp.context7.com/mcp", headers: { "x-api-key": "old" } },
      },
    };
    const { config, alreadyExists } = mergeServerEntry(existing, "mcpServers", "context7", {
      url: "https://mcp.context7.com/mcp",
    });
    expect(alreadyExists).toBe(true);
    expect((config.mcpServers as Record<string, unknown>).context7).toEqual({
      url: "https://mcp.context7.com/mcp",
    });
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

describe("removeServerEntry", () => {
  test("removes server from config section", () => {
    const { config, removed } = removeServerEntry(
      {
        mcpServers: {
          context7: { url: "https://mcp.context7.com/mcp" },
          other: { url: "https://other.com" },
        },
      },
      "mcpServers",
      "context7"
    );

    expect(removed).toBe(true);
    expect(config).toEqual({
      mcpServers: {
        other: { url: "https://other.com" },
      },
    });
  });

  test("removes empty config section when context7 is the only server", () => {
    const { config, removed } = removeServerEntry(
      {
        mcpServers: {
          context7: { url: "https://mcp.context7.com/mcp" },
        },
        theme: "dark",
      },
      "mcpServers",
      "context7"
    );

    expect(removed).toBe(true);
    expect(config).toEqual({ theme: "dark" });
  });

  test("returns original config when server is not present", () => {
    const existing = { mcpServers: { other: { url: "https://other.com" } } };
    const { config, removed } = removeServerEntry(existing, "mcpServers", "context7");

    expect(removed).toBe(false);
    expect(config).toEqual(existing);
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

describe("JSONC support", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `ctx7-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test("readJsonConfig strips comments without corrupting URLs", async () => {
    const path = join(tempDir, "config.jsonc");
    await writeFile(
      path,
      `{
  // This is a comment
  "mcp": {},
  "$schema": "https://opencode.ai/config.json"
}`,
      "utf-8"
    );
    const result = await readJsonConfig(path);
    expect(result.$schema).toBe("https://opencode.ai/config.json");
    expect(result.mcp).toEqual({});
  });

  test("readJsonConfig handles block comments", async () => {
    const path = join(tempDir, "config.jsonc");
    await writeFile(path, '{ /* block */ "key": "value" }', "utf-8");
    const result = await readJsonConfig(path);
    expect(result.key).toBe("value");
  });

  test("resolveMcpPath returns first existing candidate", async () => {
    const jsoncPath = join(tempDir, "opencode.jsonc");
    await writeFile(jsoncPath, "{}", "utf-8");
    const resolved = await resolveMcpPath([join(tempDir, "opencode.json"), jsoncPath]);
    expect(resolved).toBe(jsoncPath);
  });

  test("resolveMcpPath falls back to first candidate when none exist", async () => {
    const jsonPath = join(tempDir, "opencode.json");
    const resolved = await resolveMcpPath([jsonPath]);
    expect(resolved).toBe(jsonPath);
  });

  test("resolveMcpPath returns single candidate unchanged", async () => {
    const tomlPath = join(tempDir, "config.toml");
    const resolved = await resolveMcpPath([tomlPath]);
    expect(resolved).toBe(tomlPath);
  });
});

describe("TOML config", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `ctx7-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test("buildTomlServerBlock generates correct TOML", () => {
    const block = buildTomlServerBlock("context7", {
      url: "https://mcp.context7.com/mcp",
    });
    expect(block).toContain("[mcp_servers.context7]");
    expect(block).toContain('url = "https://mcp.context7.com/mcp"');
  });

  test("buildTomlServerBlock includes http_headers", () => {
    const block = buildTomlServerBlock("context7", {
      url: "https://mcp.context7.com/mcp",
      headers: { CONTEXT7_API_KEY: "sk-test" },
    });
    expect(block).toContain("[mcp_servers.context7]");
    expect(block).toContain("[mcp_servers.context7.http_headers]");
    expect(block).toContain('CONTEXT7_API_KEY = "sk-test"');
    expect(block).not.toContain("headers =");
  });

  test("readTomlServerExists detects existing server", async () => {
    const path = join(tempDir, "config.toml");
    await writeFile(path, '[mcp_servers.context7]\nurl = "https://test.com"\n', "utf-8");
    expect(await readTomlServerExists(path, "context7")).toBe(true);
    expect(await readTomlServerExists(path, "other")).toBe(false);
  });

  test("readTomlServerExists returns false for missing file", async () => {
    expect(await readTomlServerExists(join(tempDir, "nope.toml"), "context7")).toBe(false);
  });

  test("appendTomlServer appends to empty file", async () => {
    const path = join(tempDir, "config.toml");
    const { alreadyExists } = await appendTomlServer(path, "context7", {
      url: "https://mcp.context7.com/mcp",
    });
    expect(alreadyExists).toBe(false);
    const content = await readFile(path, "utf-8");
    expect(content).toContain("[mcp_servers.context7]");
    expect(content).toContain('url = "https://mcp.context7.com/mcp"');
  });

  test("appendTomlServer preserves existing config", async () => {
    const path = join(tempDir, "config.toml");
    await writeFile(path, 'model = "gpt-5"\n\n[mcp_servers.other]\nurl = "https://other.com"\n');
    await appendTomlServer(path, "context7", { url: "https://mcp.context7.com/mcp" });
    const content = await readFile(path, "utf-8");
    expect(content).toContain('model = "gpt-5"');
    expect(content).toContain("[mcp_servers.other]");
    expect(content).toContain("[mcp_servers.context7]");
  });

  test("appendTomlServer is idempotent", async () => {
    const path = join(tempDir, "config.toml");
    await appendTomlServer(path, "context7", { url: "https://mcp.context7.com/mcp" });
    const { alreadyExists } = await appendTomlServer(path, "context7", {
      url: "https://mcp.context7.com/mcp",
    });
    expect(alreadyExists).toBe(true);
    const content = await readFile(path, "utf-8");
    expect(content.match(/\[mcp_servers\.context7\]/g)?.length).toBe(1);
  });

  test("appendTomlServer overwrites existing server with new url", async () => {
    const path = join(tempDir, "config.toml");
    await appendTomlServer(path, "context7", { url: "https://old.com" });
    const { alreadyExists } = await appendTomlServer(path, "context7", {
      url: "https://mcp.context7.com/mcp",
    });
    expect(alreadyExists).toBe(true);
    const content = await readFile(path, "utf-8");
    expect(content.match(/\[mcp_servers\.context7\]/g)?.length).toBe(1);
    expect(content).toContain('url = "https://mcp.context7.com/mcp"');
    expect(content).not.toContain("https://old.com");
  });

  test("appendTomlServer overwrites server without affecting other servers", async () => {
    const path = join(tempDir, "config.toml");
    await writeFile(
      path,
      '[mcp_servers.context7]\nurl = "https://old.com"\n\n[mcp_servers.other]\nurl = "https://other.com"\n'
    );
    await appendTomlServer(path, "context7", { url: "https://mcp.context7.com/mcp" });
    const content = await readFile(path, "utf-8");
    expect(content).toContain('url = "https://mcp.context7.com/mcp"');
    expect(content).not.toContain("https://old.com");
    expect(content).toContain("[mcp_servers.other]");
    expect(content).toContain('url = "https://other.com"');
  });

  test("appendTomlServer overwrites server that appears before non-mcp sections", async () => {
    const path = join(tempDir, "config.toml");
    await writeFile(
      path,
      'model = "gpt-5"\n\n[mcp_servers.context7]\nurl = "https://old.com"\n\n[some_other_section]\nkey = "value"\n'
    );
    await appendTomlServer(path, "context7", {
      url: "https://mcp.context7.com/mcp",
      headers: { "x-api-key": "sk-new" },
    });
    const content = await readFile(path, "utf-8");
    expect(content).toContain('model = "gpt-5"');
    expect(content).toContain('url = "https://mcp.context7.com/mcp"');
    expect(content).toContain("[mcp_servers.context7.http_headers]");
    expect(content).toContain('x-api-key = "sk-new"');
    expect(content).not.toContain("https://old.com");
    expect(content).toContain("[some_other_section]");
    expect(content).toContain('key = "value"');
  });

  test("appendTomlServer overwrites server at end of file", async () => {
    const path = join(tempDir, "config.toml");
    await writeFile(
      path,
      '[mcp_servers.other]\nurl = "https://other.com"\n\n[mcp_servers.context7]\nurl = "https://old.com"\n'
    );
    await appendTomlServer(path, "context7", { url: "https://new.com" });
    const content = await readFile(path, "utf-8");
    expect(content).toContain("[mcp_servers.other]");
    expect(content).toContain('url = "https://new.com"');
    expect(content).not.toContain("https://old.com");
    expect(content.match(/\[mcp_servers\.context7\]/g)?.length).toBe(1);
  });

  test("appendTomlServer does not accumulate blank lines on repeated overwrites", async () => {
    const path = join(tempDir, "config.toml");
    await writeFile(
      path,
      'model = "o3"\n\n[mcp_servers.context7]\nurl = "https://old.com"\n\n[mcp_servers.other]\nurl = "https://other.com"\n'
    );

    for (let i = 1; i <= 3; i++) {
      await appendTomlServer(path, "context7", { url: `https://v${i}.com` });
    }

    const content = await readFile(path, "utf-8");
    expect(content.match(/\[mcp_servers\.context7\]/g)?.length).toBe(1);
    expect(content).toContain('url = "https://v3.com"');
    expect(content).toContain("[mcp_servers.other]");
    expect(content).not.toContain("\n\n\n");
  });

  test("removeTomlServer removes only the target server", async () => {
    const path = join(tempDir, "config.toml");
    await writeFile(
      path,
      'model = "gpt-5"\n\n[mcp_servers.context7]\nurl = "https://mcp.context7.com/mcp"\n\n[mcp_servers.other]\nurl = "https://other.com"\n',
      "utf-8"
    );

    const { removed } = await removeTomlServer(path, "context7");
    expect(removed).toBe(true);

    const content = await readFile(path, "utf-8");
    expect(content).toContain('model = "gpt-5"');
    expect(content).toContain("[mcp_servers.other]");
    expect(content).toContain('url = "https://other.com"');
    expect(content).not.toContain("[mcp_servers.context7]");
  });

  test("removeTomlServer removes nested subsections too", async () => {
    const path = join(tempDir, "config.toml");
    await writeFile(
      path,
      '[mcp_servers.context7]\nurl = "https://mcp.context7.com/mcp"\n\n[mcp_servers.context7.http_headers]\nCONTEXT7_API_KEY = "sk-test"\n\n[settings]\nmodel = "gpt-5"\n',
      "utf-8"
    );

    const { removed } = await removeTomlServer(path, "context7");
    expect(removed).toBe(true);

    const content = await readFile(path, "utf-8");
    expect(content).toContain("[settings]");
    expect(content).toContain('model = "gpt-5"');
    expect(content).not.toContain("[mcp_servers.context7]");
    expect(content).not.toContain("CONTEXT7_API_KEY");
  });

  test("removeTomlServer returns false when server is missing", async () => {
    const path = join(tempDir, "config.toml");
    await writeFile(path, '[mcp_servers.other]\nurl = "https://other.com"\n', "utf-8");

    const { removed } = await removeTomlServer(path, "context7");
    expect(removed).toBe(false);
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
    } catch {}

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

describe("agent config integration", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `ctx7-agent-cfg-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  const apiKeyAuth: AuthOptions = { mode: "api-key", apiKey: "sk-test-123" };
  const oauthAuth: AuthOptions = { mode: "oauth" };

  describe("claude", () => {
    const agent = getAgent("claude");

    test("buildEntry with api-key produces correct shape", () => {
      const entry = agent.mcp.buildEntry(apiKeyAuth);
      expect(entry).toEqual({
        type: "http",
        url: "https://mcp.context7.com/mcp",
        headers: { CONTEXT7_API_KEY: "sk-test-123" },
      });
    });

    test("buildEntry with oauth produces correct shape", () => {
      const entry = agent.mcp.buildEntry(oauthAuth);
      expect(entry).toEqual({
        type: "http",
        url: "https://mcp.context7.com/mcp/oauth",
      });
    });

    test("merges into JSON config with configKey mcpServers", async () => {
      const path = join(tempDir, ".claude.json");
      const existing = await readJsonConfig(path);
      const { config } = mergeServerEntry(
        existing,
        agent.mcp.configKey,
        "context7",
        agent.mcp.buildEntry(apiKeyAuth)
      );
      await writeJsonConfig(path, config);

      const result = await readJsonConfig(path);
      const servers = result.mcpServers as Record<string, unknown>;
      expect(servers.context7).toEqual({
        type: "http",
        url: "https://mcp.context7.com/mcp",
        headers: { CONTEXT7_API_KEY: "sk-test-123" },
      });
    });

    test("overwrites existing config in JSON", async () => {
      const path = join(tempDir, ".claude.json");
      await writeJsonConfig(path, {
        mcpServers: { context7: { type: "http", url: "https://old.com" } },
      });

      const existing = await readJsonConfig(path);
      const { config, alreadyExists } = mergeServerEntry(
        existing,
        agent.mcp.configKey,
        "context7",
        agent.mcp.buildEntry(apiKeyAuth)
      );
      expect(alreadyExists).toBe(true);
      await writeJsonConfig(path, config);

      const result = await readJsonConfig(path);
      expect((result.mcpServers as Record<string, unknown>).context7).toEqual({
        type: "http",
        url: "https://mcp.context7.com/mcp",
        headers: { CONTEXT7_API_KEY: "sk-test-123" },
      });
    });
  });

  describe("cursor", () => {
    const agent = getAgent("cursor");

    test("buildEntry with api-key produces correct shape (no type field)", () => {
      const entry = agent.mcp.buildEntry(apiKeyAuth);
      expect(entry).toEqual({
        url: "https://mcp.context7.com/mcp",
        headers: { CONTEXT7_API_KEY: "sk-test-123" },
      });
      expect(entry).not.toHaveProperty("type");
    });

    test("buildEntry with oauth produces correct shape", () => {
      const entry = agent.mcp.buildEntry(oauthAuth);
      expect(entry).toEqual({
        url: "https://mcp.context7.com/mcp/oauth",
      });
    });

    test("merges into JSON config with configKey mcpServers", async () => {
      const path = join(tempDir, "mcp.json");
      const existing = await readJsonConfig(path);
      const { config } = mergeServerEntry(
        existing,
        agent.mcp.configKey,
        "context7",
        agent.mcp.buildEntry(oauthAuth)
      );
      await writeJsonConfig(path, config);

      const result = await readJsonConfig(path);
      expect((result.mcpServers as Record<string, unknown>).context7).toEqual({
        url: "https://mcp.context7.com/mcp/oauth",
      });
    });

    test("overwrites existing config in JSON", async () => {
      const path = join(tempDir, "mcp.json");
      await writeJsonConfig(path, {
        mcpServers: { context7: { url: "https://old.com" }, other: { url: "https://other.com" } },
      });

      const existing = await readJsonConfig(path);
      const { config, alreadyExists } = mergeServerEntry(
        existing,
        agent.mcp.configKey,
        "context7",
        agent.mcp.buildEntry(apiKeyAuth)
      );
      expect(alreadyExists).toBe(true);
      await writeJsonConfig(path, config);

      const result = await readJsonConfig(path);
      const servers = result.mcpServers as Record<string, unknown>;
      expect(servers.context7).toEqual({
        url: "https://mcp.context7.com/mcp",
        headers: { CONTEXT7_API_KEY: "sk-test-123" },
      });
      expect(servers.other).toEqual({ url: "https://other.com" });
    });
  });

  describe("opencode", () => {
    const agent = getAgent("opencode");

    test("buildEntry with api-key includes type, url, enabled, and headers", () => {
      const entry = agent.mcp.buildEntry(apiKeyAuth);
      expect(entry).toEqual({
        type: "remote",
        url: "https://mcp.context7.com/mcp",
        enabled: true,
        headers: { CONTEXT7_API_KEY: "sk-test-123" },
      });
    });

    test("buildEntry with oauth includes type, url, enabled without headers", () => {
      const entry = agent.mcp.buildEntry(oauthAuth);
      expect(entry).toEqual({
        type: "remote",
        url: "https://mcp.context7.com/mcp/oauth",
        enabled: true,
      });
    });

    test("uses configKey 'mcp' instead of 'mcpServers'", () => {
      expect(agent.mcp.configKey).toBe("mcp");
    });

    test("merges into JSON config with configKey mcp", async () => {
      const path = join(tempDir, "opencode.json");
      await writeJsonConfig(path, { $schema: "https://opencode.ai/config.json" });

      const existing = await readJsonConfig(path);
      const { config } = mergeServerEntry(
        existing,
        agent.mcp.configKey,
        "context7",
        agent.mcp.buildEntry(apiKeyAuth)
      );
      await writeJsonConfig(path, config);

      const result = await readJsonConfig(path);
      expect(result.$schema).toBe("https://opencode.ai/config.json");
      expect((result.mcp as Record<string, unknown>).context7).toEqual({
        type: "remote",
        url: "https://mcp.context7.com/mcp",
        enabled: true,
        headers: { CONTEXT7_API_KEY: "sk-test-123" },
      });
    });

    test("overwrites existing config in JSON", async () => {
      const path = join(tempDir, "opencode.json");
      await writeJsonConfig(path, {
        mcp: { context7: { type: "remote", url: "https://old.com", enabled: true } },
      });

      const existing = await readJsonConfig(path);
      const { config, alreadyExists } = mergeServerEntry(
        existing,
        agent.mcp.configKey,
        "context7",
        agent.mcp.buildEntry(oauthAuth)
      );
      expect(alreadyExists).toBe(true);
      await writeJsonConfig(path, config);

      const result = await readJsonConfig(path);
      expect((result.mcp as Record<string, unknown>).context7).toEqual({
        type: "remote",
        url: "https://mcp.context7.com/mcp/oauth",
        enabled: true,
      });
    });

    test("works with JSONC files containing comments", async () => {
      const path = join(tempDir, "opencode.jsonc");
      await writeFile(
        path,
        `{
  // OpenCode config
  "$schema": "https://opencode.ai/config.json",
  "mcp": {}
}`,
        "utf-8"
      );

      const existing = await readJsonConfig(path);
      const { config } = mergeServerEntry(
        existing,
        agent.mcp.configKey,
        "context7",
        agent.mcp.buildEntry(apiKeyAuth)
      );
      await writeJsonConfig(path, config);

      const result = await readJsonConfig(path);
      expect(result.$schema).toBe("https://opencode.ai/config.json");
      expect((result.mcp as Record<string, unknown>).context7).toBeTruthy();
    });
  });

  describe("codex", () => {
    const agent = getAgent("codex");

    test("buildEntry with api-key produces correct shape", () => {
      const entry = agent.mcp.buildEntry(apiKeyAuth);
      expect(entry).toEqual({
        type: "http",
        url: "https://mcp.context7.com/mcp",
        headers: { CONTEXT7_API_KEY: "sk-test-123" },
      });
    });

    test("buildEntry with oauth produces correct shape", () => {
      const entry = agent.mcp.buildEntry(oauthAuth);
      expect(entry).toEqual({
        type: "http",
        url: "https://mcp.context7.com/mcp/oauth",
      });
    });

    test("appends to TOML config", async () => {
      const path = join(tempDir, "config.toml");
      const { alreadyExists } = await appendTomlServer(
        path,
        "context7",
        agent.mcp.buildEntry(apiKeyAuth)
      );
      expect(alreadyExists).toBe(false);

      const content = await readFile(path, "utf-8");
      expect(content).toContain("[mcp_servers.context7]");
      expect(content).toContain('type = "http"');
      expect(content).toContain('url = "https://mcp.context7.com/mcp"');
      expect(content).toContain("[mcp_servers.context7.http_headers]");
      expect(content).toContain('CONTEXT7_API_KEY = "sk-test-123"');
    });

    test("appends oauth entry to TOML without headers", async () => {
      const path = join(tempDir, "config.toml");
      await appendTomlServer(path, "context7", agent.mcp.buildEntry(oauthAuth));

      const content = await readFile(path, "utf-8");
      expect(content).toContain("[mcp_servers.context7]");
      expect(content).toContain('url = "https://mcp.context7.com/mcp/oauth"');
      expect(content).not.toContain("http_headers");
    });

    test("overwrites existing TOML config", async () => {
      const path = join(tempDir, "config.toml");
      await appendTomlServer(path, "context7", agent.mcp.buildEntry(oauthAuth));
      const { alreadyExists } = await appendTomlServer(
        path,
        "context7",
        agent.mcp.buildEntry(apiKeyAuth)
      );

      expect(alreadyExists).toBe(true);
      const content = await readFile(path, "utf-8");
      expect(content.match(/\[mcp_servers\.context7\]/g)?.length).toBe(1);
      expect(content).toContain('url = "https://mcp.context7.com/mcp"');
      expect(content).not.toContain("mcp/oauth");
      expect(content).toContain('CONTEXT7_API_KEY = "sk-test-123"');
    });

    test("overwrites TOML config preserving other servers", async () => {
      const path = join(tempDir, "config.toml");
      await writeFile(
        path,
        '[mcp_servers.other]\nurl = "https://other.com"\n\n[mcp_servers.context7]\ntype = "http"\nurl = "https://old.com"\n'
      );
      await appendTomlServer(path, "context7", agent.mcp.buildEntry(apiKeyAuth));

      const content = await readFile(path, "utf-8");
      expect(content).toContain("[mcp_servers.other]");
      expect(content).toContain('url = "https://other.com"');
      expect(content).toContain('url = "https://mcp.context7.com/mcp"');
      expect(content).not.toContain("https://old.com");
    });
  });

  describe("gemini", () => {
    const agent = getAgent("gemini");

    test("buildEntry with api-key uses httpUrl", () => {
      const entry = agent.mcp.buildEntry(apiKeyAuth);
      expect(entry).toEqual({
        httpUrl: "https://mcp.context7.com/mcp",
        headers: { CONTEXT7_API_KEY: "sk-test-123" },
      });
      expect(entry).not.toHaveProperty("url");
    });

    test("buildEntry with oauth uses httpUrl without headers", () => {
      const entry = agent.mcp.buildEntry(oauthAuth);
      expect(entry).toEqual({
        httpUrl: "https://mcp.context7.com/mcp/oauth",
      });
    });

    test("uses configKey mcpServers", () => {
      expect(agent.mcp.configKey).toBe("mcpServers");
    });

    test("merges into settings.json with mcpServers key", async () => {
      const path = join(tempDir, "settings.json");
      await writeJsonConfig(path, { theme: "dark" });

      const existing = await readJsonConfig(path);
      const { config } = mergeServerEntry(
        existing,
        agent.mcp.configKey,
        "context7",
        agent.mcp.buildEntry(apiKeyAuth)
      );
      await writeJsonConfig(path, config);

      const result = await readJsonConfig(path);
      expect(result.theme).toBe("dark");
      expect((result.mcpServers as Record<string, unknown>).context7).toEqual({
        httpUrl: "https://mcp.context7.com/mcp",
        headers: { CONTEXT7_API_KEY: "sk-test-123" },
      });
    });

    test("overwrites existing config in JSON", async () => {
      const path = join(tempDir, "settings.json");
      await writeJsonConfig(path, {
        mcpServers: { context7: { httpUrl: "https://old.com" } },
      });

      const existing = await readJsonConfig(path);
      const { config, alreadyExists } = mergeServerEntry(
        existing,
        agent.mcp.configKey,
        "context7",
        agent.mcp.buildEntry(apiKeyAuth)
      );
      expect(alreadyExists).toBe(true);
      await writeJsonConfig(path, config);

      const result = await readJsonConfig(path);
      expect((result.mcpServers as Record<string, unknown>).context7).toEqual({
        httpUrl: "https://mcp.context7.com/mcp",
        headers: { CONTEXT7_API_KEY: "sk-test-123" },
      });
    });
  });

  describe("all agents have consistent config", () => {
    test("all agents are covered", () => {
      expect(ALL_AGENT_NAMES).toEqual(["claude", "cursor", "opencode", "codex", "gemini"]);
    });

    test.each(ALL_AGENT_NAMES)("%s buildEntry returns url for both auth modes", (name) => {
      const agent = getAgent(name);
      const apiEntry = agent.mcp.buildEntry(apiKeyAuth);
      const oauthEntry = agent.mcp.buildEntry(oauthAuth);

      const urlKey = name === "gemini" ? "httpUrl" : "url";
      expect(apiEntry[urlKey]).toBe("https://mcp.context7.com/mcp");
      expect(oauthEntry[urlKey]).toBe("https://mcp.context7.com/mcp/oauth");
    });

    test.each(ALL_AGENT_NAMES)("%s buildEntry includes headers only for api-key auth", (name) => {
      const agent = getAgent(name);
      const apiEntry = agent.mcp.buildEntry(apiKeyAuth);
      const oauthEntry = agent.mcp.buildEntry(oauthAuth);

      expect(apiEntry.headers).toEqual({ CONTEXT7_API_KEY: "sk-test-123" });
      expect(oauthEntry).not.toHaveProperty("headers");
    });

    test.each(ALL_AGENT_NAMES)("%s buildEntry without apiKey omits headers", (name) => {
      const agent = getAgent(name);
      const entry = agent.mcp.buildEntry({ mode: "api-key" });
      expect(entry).not.toHaveProperty("headers");
    });
  });
});
