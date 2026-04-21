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

export const log = {
  info: (message: string) => console.log(pc.cyan(message)),
  success: (message: string) => console.log(pc.green(`✔ ${message}`)),
  warn: (message: string) => console.log(pc.yellow(`⚠ ${message}`)),
  error: (message: string) => console.log(pc.red(`✖ ${message}`)),
  dim: (message: string) => console.log(pc.dim(message)),
  item: (message: string) => console.log(pc.green(`  ${message}`)),
  itemAdd: (message: string) => console.log(`  ${pc.green("+")} ${message}`),
  plain: (message: string) => console.log(message),
  blank: () => console.log(""),
  box,
};
