import pc from "picocolors";

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
};
