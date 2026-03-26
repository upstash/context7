import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { access } from "fs/promises";
import { join } from "path";

// Mock fs/promises
vi.mock("fs/promises", () => ({
  access: vi.fn(),
}));

// Mock os - need to mock before importing the module that uses it
vi.mock("os", () => ({
  homedir: vi.fn(() => "/home/testuser"),
}));

import { detectAgents, getAgent, ALL_AGENT_NAMES } from "../setup/agents.js";

describe("agent detection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("opencode detection", () => {
    test("detects opencode from .opencode.json", async () => {
      vi.mocked(access).mockImplementation(async (path: string) => {
        if (path === join(process.cwd(), ".opencode.json")) {
          return undefined; // exists
        }
        throw new Error("not found");
      });

      const detected = await detectAgents("project");
      expect(detected).toContain("opencode");
    });

    test("detects opencode from .opencode.jsonc", async () => {
      vi.mocked(access).mockImplementation(async (path: string) => {
        if (path === join(process.cwd(), ".opencode.jsonc")) {
          return undefined; // exists
        }
        throw new Error("not found");
      });

      const detected = await detectAgents("project");
      expect(detected).toContain("opencode");
    });

    test("does not detect opencode when neither config file exists", async () => {
      vi.mocked(access).mockRejectedValue(new Error("not found"));

      const detected = await detectAgents("project");
      expect(detected).not.toContain("opencode");
    });

    test("detects opencode globally from config directory", async () => {
      vi.mocked(access).mockImplementation(async (path: string) => {
        if (path === join("/home/testuser", ".config", "opencode")) {
          return undefined; // exists
        }
        throw new Error("not found");
      });

      const detected = await detectAgents("global");
      expect(detected).toContain("opencode");
    });
  });

  describe("getAgent", () => {
    test("returns correct config for opencode", () => {
      const agent = getAgent("opencode");
      expect(agent.name).toBe("opencode");
      expect(agent.displayName).toBe("OpenCode");
      expect(agent.detect.projectPaths).toContain(".opencode.json");
      expect(agent.detect.projectPaths).toContain(".opencode.jsonc");
    });

    test("returns correct config for claude", () => {
      const agent = getAgent("claude");
      expect(agent.name).toBe("claude");
      expect(agent.displayName).toBe("Claude Code");
    });

    test("returns correct config for cursor", () => {
      const agent = getAgent("cursor");
      expect(agent.name).toBe("cursor");
      expect(agent.displayName).toBe("Cursor");
    });
  });

  describe("ALL_AGENT_NAMES", () => {
    test("contains all supported agents", () => {
      expect(ALL_AGENT_NAMES).toContain("claude");
      expect(ALL_AGENT_NAMES).toContain("cursor");
      expect(ALL_AGENT_NAMES).toContain("opencode");
      expect(ALL_AGENT_NAMES).toHaveLength(3);
    });
  });
});
