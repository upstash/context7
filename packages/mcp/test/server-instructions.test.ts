import { describe, expect, test } from "vitest";
import { DOCS_FEEDBACK_INSTRUCTIONS } from "../src/lib/experimental-tools.js";
import {
  CLAUDE_CODE_INSTRUCTIONS_LIMIT,
  SERVER_INSTRUCTIONS,
  serverInstructions,
} from "../src/lib/server-instructions.js";

describe("serverInstructions", () => {
  test("adds the feedback request only when that tool is on", () => {
    expect(serverInstructions(false)).toBe(SERVER_INSTRUCTIONS);
    expect(serverInstructions(true)).toBe(
      `${SERVER_INSTRUCTIONS}\n\n${DOCS_FEEDBACK_INSTRUCTIONS}`
    );
  });

  test("fits Claude Code's limit with the feedback request, so no line is cut", () => {
    expect(serverInstructions(true).length).toBeLessThanOrEqual(CLAUDE_CODE_INSTRUCTIONS_LIMIT);
  });
});
