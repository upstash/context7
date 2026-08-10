import { describe, expect, it } from "vitest";
import type { Config } from "@opencode-ai/plugin";
import {
  AGENT_NAME,
  COMMAND_NAME,
  MCP_SERVER_NAME,
  applyContext7Config,
  resolveApiKey,
} from "../src/config.js";

const SKILLS_DIR = "/pkg/skills";

type ConfigWithSkills = Config & { skills?: { paths?: string[]; urls?: string[] } };

function apply(config: Config, apiKey?: string): ConfigWithSkills {
  applyContext7Config(config, { apiKey, skillsDir: SKILLS_DIR });
  return config as ConfigWithSkills;
}

describe("resolveApiKey", () => {
  it("returns undefined when neither the options nor the environment carry a key", () => {
    expect(resolveApiKey(undefined, {})).toBeUndefined();
  });

  it("falls back to CONTEXT7_API_KEY", () => {
    expect(resolveApiKey({}, { CONTEXT7_API_KEY: "env-key" })).toBe("env-key");
  });

  it("prefers an explicit apiKey option over the environment", () => {
    expect(resolveApiKey({ apiKey: "opt-key" }, { CONTEXT7_API_KEY: "env-key" })).toBe("opt-key");
  });

  it("ignores empty strings so they never become a Bearer header", () => {
    expect(resolveApiKey({ apiKey: "" }, { CONTEXT7_API_KEY: "" })).toBeUndefined();
  });

  it("ignores an apiKey option that is not a string", () => {
    expect(resolveApiKey({ apiKey: 42 }, {})).toBeUndefined();
  });
});

describe("applyContext7Config", () => {
  // The endpoints are asserted as literals on purpose. Comparing against the exported
  // constants would pass even if the URLs were wrong.
  it("points at the OAuth endpoint when no api key is available", () => {
    const config = apply({});

    expect(config.mcp?.[MCP_SERVER_NAME]).toEqual({
      type: "remote",
      url: "https://mcp.context7.com/mcp/oauth",
      enabled: true,
    });
  });

  it("points at the plain endpoint and disables OAuth when an api key is available", () => {
    const config = apply({}, "secret");

    expect(config.mcp?.[MCP_SERVER_NAME]).toEqual({
      type: "remote",
      url: "https://mcp.context7.com/mcp",
      enabled: true,
      headers: { Authorization: "Bearer secret" },
      oauth: false,
    });
  });

  it("registers the skill directory, the subagent, and the command", () => {
    const config = apply({});

    expect(config.skills?.paths).toEqual([SKILLS_DIR]);
    expect(config.agent?.[AGENT_NAME]).toMatchObject({ mode: "subagent" });
    expect(config.command?.[COMMAND_NAME]?.template).toContain("resolve-library-id");
  });

  it("denies edits for the agent", () => {
    const config = apply({});

    expect(config.agent?.[AGENT_NAME]?.permission).toEqual({ edit: "deny" });
  });

  it("never overwrites an existing context7 mcp server", () => {
    const existing = { type: "local" as const, command: ["npx", "-y", "@upstash/context7-mcp"] };
    const config = apply({ mcp: { [MCP_SERVER_NAME]: existing } }, "secret");

    expect(config.mcp?.[MCP_SERVER_NAME]).toBe(existing);
  });

  it("never overwrites an existing agent or command of the same name", () => {
    const agent = { description: "mine" };
    const command = { template: "mine" };
    const config = apply({ agent: { [AGENT_NAME]: agent }, command: { [COMMAND_NAME]: command } });

    expect(config.agent?.[AGENT_NAME]).toBe(agent);
    expect(config.command?.[COMMAND_NAME]).toBe(command);
  });

  it("preserves user skill paths and stays idempotent", () => {
    const config = apply({ skills: { paths: ["./team-skills"] } } as Config);
    apply(config);

    expect(config.skills?.paths).toEqual(["./team-skills", SKILLS_DIR]);
  });

  it("leaves unrelated mcp servers alone", () => {
    const config = apply({ mcp: { other: { type: "remote", url: "https://example.com/mcp" } } });

    expect(Object.keys(config.mcp ?? {})).toEqual(["other", MCP_SERVER_NAME]);
  });
});
