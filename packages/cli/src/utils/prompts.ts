import pc from "picocolors";
import { checkbox } from "@inquirer/prompts";
import readline from "readline";

export async function checkboxWithHover<T extends { name: string }>(
  config: Parameters<typeof checkbox<T>>[0]
): Promise<T[]> {
  const choices = config.choices.filter(
    (c): c is { value: T; name?: string } =>
      typeof c === "object" && c !== null && !("type" in c && c.type === "separator")
  );
  const values = choices.map((c) => c.value);
  const totalItems = values.length;
  let cursorPosition = 0;

  const keypressHandler = (_str: string, key: readline.Key) => {
    if (key.name === "up" && cursorPosition > 0) {
      cursorPosition--;
    } else if (key.name === "down" && cursorPosition < totalItems - 1) {
      cursorPosition++;
    }
  };

  readline.emitKeypressEvents(process.stdin);
  process.stdin.on("keypress", keypressHandler);

  const customConfig = {
    ...config,
    theme: {
      ...config.theme,
      style: {
        ...config.theme?.style,
        renderSelectedChoices: (
          selected: Array<{ name?: string; value: unknown }>,
          _allChoices: Array<{ name?: string; value: unknown }>
        ): string => {
          if (selected.length === 0) {
            return pc.dim(values[cursorPosition].name);
          }
          return selected.map((c) => (c.value as T).name).join(", ");
        },
      },
    },
  };

  try {
    const selected = await checkbox(customConfig);
    if (selected.length === 0) {
      return [values[cursorPosition]];
    }
    return selected;
  } finally {
    process.stdin.removeListener("keypress", keypressHandler);
  }
}
