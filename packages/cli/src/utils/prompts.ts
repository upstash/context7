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
 * Formats install count into a popularity star rating (4 stars).
 * 0/unknown → ☆☆☆☆, <100 → ★☆☆☆, <500 → ★★☆☆, <1000 → ★★★☆, 1000+ → ★★★★
 */
export function formatPopularity(count: number | undefined): string {
  const filled = "★";
  const empty = "☆";
  const max = 4;
  let stars: number;
  if (count === undefined || count === 0) stars = 0;
  else if (count < 100) stars = 1;
  else if (count < 500) stars = 2;
  else if (count < 1000) stars = 3;
  else stars = 4;

  const filledPart = filled.repeat(stars);
  const emptyPart = empty.repeat(max - stars);
  if (stars === 0) return pc.dim(emptyPart);
  return pc.yellow(filledPart) + pc.dim(emptyPart);
}

/**
 * Returns the install count as a human-readable range string.
 */
export function formatInstallRange(count: number | undefined): string {
  if (count === undefined || count === 0) return "Unknown";
  if (count < 100) return "<100";
  if (count < 500) return "<500";
  if (count < 1000) return "<1,000";
  return "1,000+";
}

/**
 * Formats trust score as High / Medium / Low label.
 * Uses MCP reputation thresholds: >=7 High, >=4 Medium, <4 Low.
 */
export function formatTrust(score: number | undefined): string {
  if (score === undefined || score < 0) return pc.dim("-");
  if (score >= 7) return pc.green("High");
  if (score >= 4) return pc.yellow("Medium");
  return pc.red("Low");
}

/**
 * Returns the raw trust label string (uncolored) for width calculations.
 */
export function getTrustLabel(score: number | undefined): string {
  if (score === undefined || score < 0) return "-";
  if (score >= 7) return "High";
  if (score >= 4) return "Medium";
  return "Low";
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
        answer: (text: string) => pc.green(text),
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
