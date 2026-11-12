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
});
