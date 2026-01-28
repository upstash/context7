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
  return `\x1b]8;;${url}\x07${colorFn(text)}\x1b]8;;\x07`;
}

/**
 * Formats install count with rounded display showing highest round number.
 * Examples: 5→"5", 15→"10+", 67→"50+", 150→"100+", 350→"300+", 1500→"1k+"
 */
export function formatInstallCount(count: number | undefined): string {
  if (count === undefined || count === 0) return "";

  let display: string;
  if (count >= 1000) {
    display = `${Math.floor(count / 1000)}k+`;
  } else if (count >= 100) {
    const hundreds = Math.floor(count / 100) * 100;
    display = `${hundreds}+`;
  } else if (count >= 10) {
    const tens = Math.floor(count / 10) * 10;
    display = `${tens}+`;
  } else {
    display = String(count);
  }

  return `\x1b[38;5;214m↓${display}\x1b[0m`;
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
