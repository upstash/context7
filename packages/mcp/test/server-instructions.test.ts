import { describe, expect, test } from "vitest";
import { CODE_TOOLS_INSTRUCTIONS } from "../src/lib/code-tools.js";
import { DOCS_FEEDBACK_INSTRUCTIONS } from "../src/lib/experimental-tools.js";
import {
  CLAUDE_CODE_INSTRUCTIONS_LIMIT,
  SERVER_INSTRUCTIONS,
  serverInstructions,
} from "../src/lib/server-instructions.js";

describe("serverInstructions", () => {
  test("puts the base text first, then the sections of the tools that are on", () => {
    expect(serverInstructions()).toBe(SERVER_INSTRUCTIONS);
    expect(serverInstructions({ feedbackRequest: true })).toBe(
      `${SERVER_INSTRUCTIONS}\n\n${DOCS_FEEDBACK_INSTRUCTIONS}`
    );
    expect(serverInstructions({ codeTools: true, feedbackRequest: true })).toBe(
      `${SERVER_INSTRUCTIONS}\n\n${CODE_TOOLS_INSTRUCTIONS}\n\n${DOCS_FEEDBACK_INSTRUCTIONS}`
    );
  });

  test("fits Claude Code's limit with the feedback request, so no line is cut", () => {
    expect(serverInstructions({ feedbackRequest: true }).length).toBeLessThanOrEqual(
      CLAUDE_CODE_INSTRUCTIONS_LIMIT
    );
  });

  test("keeps the whole base text within Claude Code's limit when every section is on", () => {
    // The sections after it can be cut; the base text, which drives the lookups, never is.
    expect(
      serverInstructions({ codeTools: true, feedbackRequest: true }).slice(
        0,
        CLAUDE_CODE_INSTRUCTIONS_LIMIT
      )
    ).toContain(SERVER_INSTRUCTIONS);
  });

  test("keeps the code tools trigger sentence within Claude Code's limit when every section is on", () => {
    // Claude Code cuts the rest of this section. The first sentence says when to read the source.
    const trigger = CODE_TOOLS_INSTRUCTIONS.slice(0, CODE_TOOLS_INSTRUCTIONS.indexOf(". ") + 1);
    expect(trigger).toMatch(/read the library's source with .*'find-symbol'\.$/);
    expect(
      serverInstructions({ codeTools: true, feedbackRequest: true }).slice(
        0,
        CLAUDE_CODE_INSTRUCTIONS_LIMIT
      )
    ).toContain(trigger);
  });
});
