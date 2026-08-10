import { describe, expect, it } from "vitest";
import type { Config } from "@opencode-ai/plugin";
import {
  AGENT_NAME,
  COMMAND_NAME,
  MCP_OAUTH_URL,
  MCP_SERVER_NAME,
  MCP_URL,
  applyContext7Config,
  resolveOptions,
} from "../src/config.js";

const SKILLS_DIR = "/pkg/skills";

type ConfigWithSkills = Config & { skills?: { paths?: string[]; urls?: string[] } };

function apply(config: Config, overrides: Record<string, unknown> = {}): ConfigWithSkills {
  applyContext7Config(config, { skillsDir: SKILLS_DIR, ...overrides });
  return config as ConfigWithSkills;
}

describe("resolveOptions", () => {
  it("defaults every component to enabled and reads no key", () => {
    expect(resolveOptions(undefined, {})).toEqual({
      apiKey: undefined,
      skill: true,
      agent: true,
      command: true,
    });
  });

  it("falls back to CONTEXT7_API_KEY", () => {
    expect(resolveOptions({}, { CONTEXT7_API_KEY: "env-key" }).apiKey).toBe("env-key");
  });

  it("prefers an explicit apiKey option over the environment", () => {
    expect(resolveOptions({ apiKey: "opt-key" }, { CONTEXT7_API_KEY: "env-key" }).apiKey).toBe(
      "opt-key"
    );
  });

  it("ignores an empty api key", () => {
    expect(resolveOptions({ apiKey: "" }, {}).apiKey).toBeUndefined();
  });

  it("ignores non-boolean toggles", () => {
    expect(resolveOptions({ skill: "no" }, {})).toMatchObject({ skill: true });
  });

  it("honours explicit toggles", () => {
    expect(resolveOptions({ skill: false, agent: false, command: false }, {})).toMatchObject({
      skill: false,
      agent: false,
      command: false,
    });
  });
});

describe("applyContext7Config", () => {
  it("registers the OAuth endpoint when no api key is available", () => {
    const config = apply({});

    expect(config.mcp?.[MCP_SERVER_NAME]).toEqual({
      type: "remote",
      url: MCP_OAUTH_URL,
      enabled: true,
    });
  });

  it("registers the api key endpoint and disables OAuth when a key is available", () => {
    const config = apply({}, { apiKey: "secret" });

    expect(config.mcp?.[MCP_SERVER_NAME]).toEqual({
      type: "remote",
      url: MCP_URL,
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

  it("skips components that are turned off", () => {
    const config = apply({}, { skill: false, agent: false, command: false });

    expect(config.skills).toBeUndefined();
    expect(config.agent).toBeUndefined();
    expect(config.command).toBeUndefined();
    expect(config.mcp?.[MCP_SERVER_NAME]).toBeDefined();
  });

  it("never overwrites an existing context7 mcp server", () => {
    const existing = { type: "local" as const, command: ["npx", "-y", "@upstash/context7-mcp"] };
    const config = apply({ mcp: { [MCP_SERVER_NAME]: existing } }, { apiKey: "secret" });

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
