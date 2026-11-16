import pc from "picocolors";

const ANSI_PATTERN = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;

function visibleLength(text: string): number {
  return text.replace(ANSI_PATTERN, "").length;
}

function padVisible(text: string, width: number): string {
  const padding = Math.max(0, width - visibleLength(text));
  return text + " ".repeat(padding);
}

export function box(lines: string[], color: (message: string) => string = pc.green): void {
  const contentWidth = Math.max(...lines.map((line) => visibleLength(line)), 0);
  const top = color(`┌${"─".repeat(contentWidth + 2)}┐`);
  const bottom = color(`└${"─".repeat(contentWidth + 2)}┘`);

  console.log(top);
  for (const line of lines) {
    console.log(color("│ ") + padVisible(line, contentWidth) + color(" │"));
  }
  console.log(bottom);
}

/**
 * Writes a diagnostic. When stdout is piped (`ctx7 code ... | grep x`), the
 * pipe would hide it, so it goes to stderr; a terminal shows it on stdout.
 */
function diagnostic(text: string): void {
  if (process.stdout.isTTY) console.log(text);
  else console.error(text);
}

export const log = {
  info: (message: string) => console.log(pc.cyan(message)),
  success: (message: string) => console.log(pc.green(`✔ ${message}`)),
  warn: (message: string) => diagnostic(pc.yellow(`⚠ ${message}`)),
  error: (message: string) => diagnostic(pc.red(`✖ ${message}`)),
  /** A hint that belongs with a warning or an error, so it goes where they go. */
  notice: (message: string) => diagnostic(pc.cyan(message)),
  dim: (message: string) => console.log(pc.dim(message)),
  item: (message: string) => console.log(pc.green(`  ${message}`)),
  itemAdd: (message: string) => console.log(`  ${pc.green("+")} ${message}`),
  plain: (message: string) => console.log(message),
  blank: () => console.log(""),
  box,
};
