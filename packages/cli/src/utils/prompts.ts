import pc from "picocolors";
import { checkbox, type Separator } from "@inquirer/prompts";
import readline from "readline";

type CheckboxConfig<T> = Parameters<typeof checkbox<T>>[0];
type CheckboxChoice<T> = Exclude<CheckboxConfig<T>["choices"][number], Separator | string>;

/**
 * Creates a clickable terminal hyperlink using OSC 8 escape sequence.
 */
export function terminalLink(text: string, url: string, color?: (s: string) => string): string {
  const colorFn = color ?? ((s: string) => s);
  return `\x1b]8;;${url}\x07${colorFn(text)}\x1b]8;;\x07 ${pc.white("↗")}`;
}

/**
 * Formats install count for display.
 */
export function formatInstallCount(count: number | undefined, placeholder = ""): string {
  if (count === undefined || count === 0) return placeholder;

  return pc.yellow(String(count));
}

export function formatTrustScore(score: number | undefined): string {
  if (score === undefined || score < 0) return pc.dim("-");

  if (score < 3) return pc.red(score.toFixed(1));
  return pc.yellow(score.toFixed(1));
}
export interface CheckboxWithHoverOptions<T> {
  /** Function to extract display name from value. Defaults to (v) => v.name */
  getName?: (value: T) => string;
}

export async function checkboxWithHover<T>(
  config: CheckboxConfig<T>,
  options?: CheckboxWithHoverOptions<T>
): Promise<T[]> {
  const choices = config.choices.filter(
    (c): c is CheckboxChoice<T> =>
      typeof c === "object" && c !== null && !("type" in c && c.type === "separator")
  );
  const values = choices.map((c) => c.value);
  const totalItems = values.length;
  let cursorPosition = 0;

  // Default getName assumes object has 'name' property
  const getName = options?.getName ?? ((v: T) => (v as { name: string }).name);

  const keypressHandler = (_str: string | undefined, key: readline.Key) => {
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
        highlight: (text: string) => pc.green(text),
        renderSelectedChoices: (
          selected: CheckboxChoice<T>[],
          _allChoices: CheckboxChoice<T>[]
        ): string => {
          if (selected.length === 0) {
            return pc.dim(getName(values[cursorPosition]));
          }
          return selected.map((c) => getName(c.value)).join(", ");
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
