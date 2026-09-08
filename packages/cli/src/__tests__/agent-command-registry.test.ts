import { describe, expect, test } from "vitest";
import { Command } from "commander";

import { registerSetupCommand } from "../commands/setup.js";
import { registerRemoveCommand } from "../commands/remove.js";
import { ALL_AGENT_NAMES, getAgent } from "../setup/agents.js";

function registeredLongOptions(command: Command): string[] {
  return command.options.flatMap((option) => (option.long ? [option.long] : []));
}

describe("agent command registry", () => {
  test.each([
    ["setup", registerSetupCommand],
    ["remove", registerRemoveCommand],
  ] as const)("%s exposes every registered agent flag", (commandName, register) => {
    const program = new Command();
    register(program);

    const command = program.commands.find((candidate) => candidate.name() === commandName);
    expect(command).toBeDefined();
    expect(registeredLongOptions(command!)).toEqual(
      expect.arrayContaining(ALL_AGENT_NAMES.map((name) => `--${name}`))
    );
  });

  test("file-specific rule formatting belongs to the agent policy", () => {
    const cursorRule = getAgent("cursor").rule;
    expect(cursorRule.kind).toBe("file");
    if (cursorRule.kind === "file") {
      expect(cursorRule.contentPrefix).toBe(`---\nalwaysApply: true\n---\n\n`);
    }
  });
});
