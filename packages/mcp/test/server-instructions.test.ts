import { readFile } from "node:fs/promises";
import { describe, expect, test } from "vitest";
import { DOCS_FEEDBACK_INSTRUCTIONS } from "../src/lib/research-preview-tools.js";
import {
  CLAUDE_CODE_INSTRUCTIONS_LIMIT,
  SERVER_INSTRUCTIONS,
  serverInstructions,
} from "../src/lib/server-instructions.js";

describe("serverInstructions", () => {
  test("adds the feedback request only under research preview", () => {
    expect(serverInstructions(false)).toBe(SERVER_INSTRUCTIONS);
    expect(serverInstructions(true)).toBe(
      `${SERVER_INSTRUCTIONS}\n\n${DOCS_FEEDBACK_INSTRUCTIONS}`
    );
  });

  test("fits Claude Code's limit with research preview on, so no line is cut", () => {
    expect(serverInstructions(true).length).toBeLessThanOrEqual(CLAUDE_CODE_INSTRUCTIONS_LIMIT);
  });

  // rules/context7-mcp.md, and through its own guards every rule, skill and plugin copy, must
  // say what this server says. Without this, an edit here leaves all the copies behind.
  test("rules/context7-mcp.md has this text before its steps", async () => {
    const rule = await readFile(
      new URL("../../../rules/context7-mcp.md", import.meta.url),
      "utf-8"
    );
    const core = rule
      .slice(0, rule.indexOf("## Steps"))
      .trim()
      .replace(/:\n\n- /g, ":\n- ");
    expect(core).toBe(SERVER_INSTRUCTIONS);
  });
});
