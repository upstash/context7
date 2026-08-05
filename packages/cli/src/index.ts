import { Command } from "commander";
import path from "node:path";
import pc from "picocolors";
import figlet from "figlet";
import { registerSkillCommands, registerSkillAliases } from "./commands/skill.js";
import { registerAuthCommands, setAuthBaseUrl } from "./commands/auth.js";
import { registerSetupCommand } from "./commands/setup.js";
import { registerRemoveCommand } from "./commands/remove.js";
import { registerDocsCommands } from "./commands/docs.js";
import { registerAddCommand } from "./commands/add.js";
import { maybeShowUpgradeNotice, registerUpgradeCommand } from "./commands/upgrade.js";
import { setBaseUrl } from "./utils/api.js";
import { VERSION } from "./constants.js";

const brand = {
  primary: pc.green,
  dim: pc.dim,
};

function resolveInvokedName(): string {
  const raw = process.argv[1] ? path.basename(process.argv[1]) : "ctx7";
  const base = raw.replace(/\.(js|mjs|cjs|exe|cmd|ps1)$/i, "");
  return base === "context7" ? "context7" : "ctx7";
}

const cliName = resolveInvokedName();

const program = new Command();

program
  .name(cliName)
  .description("Context7 CLI - Fetch documentation context and configure Context7")
  .version(VERSION, "-v, --version")
  .option("--base-url <url>")
  .hook("preAction", (thisCommand) => {
    const opts = thisCommand.opts();
    if (opts.baseUrl) {
      setBaseUrl(opts.baseUrl);
      setAuthBaseUrl(opts.baseUrl);
    }
  })
  .hook("preAction", async (_thisCommand, actionCommand) => {
    await maybeShowUpgradeNotice({
      actionName: actionCommand.name(),
      argv: process.argv,
    });
  })
  .addHelpText(
    "after",
    `
Examples:
  ${brand.dim("# Configure Context7 for your coding agent")}
  ${brand.primary(`npx ctx7 setup`)}
  ${brand.primary(`npx ctx7 setup --mcp`)}
  ${brand.primary(`npx ctx7 setup --cli`)}

  ${brand.dim("# Remove Context7 setup")}
  ${brand.primary(`npx ctx7 remove --cursor`)}
  ${brand.primary(`npx ctx7 remove --cursor --all`)}
  ${brand.primary(`npx ctx7 remove --cursor --cli`)}
  ${brand.primary(`npx ctx7 remove --claude --mcp`)}

  ${brand.dim("# Query library documentation")}
  ${brand.primary(`npx ctx7 library react "how to use hooks"`)}
  ${brand.primary(`npx ctx7 docs /facebook/react "useEffect examples"`)}

  ${brand.dim("# Submit a library for indexing (requires API key / login)")}
  ${brand.primary(`npx ctx7 add https://github.com/owner/repo`)}
  ${brand.primary(`npx context7 add https://docs.example.com --type website --json`)}

Note: \`context7\` is an alias for \`ctx7\` after \`npm install -g ctx7\`.
`
  );

registerSkillCommands(program);
registerSkillAliases(program);
registerAuthCommands(program);
registerSetupCommand(program);
registerRemoveCommand(program);
registerDocsCommands(program);
registerAddCommand(program);
registerUpgradeCommand(program);

program.action(() => {
  console.log("");
  const banner = figlet.textSync("Context7", { font: "ANSI Shadow" });
  console.log(brand.primary(banner));
  console.log(brand.dim("  Documentation context for AI coding agents"));
  console.log("");

  console.log("  Quick start:");
  console.log(`    ${brand.primary("npx ctx7 setup")}`);
  console.log(`    ${brand.primary('npx ctx7 docs /facebook/react "useEffect examples"')}`);
  console.log(`    ${brand.primary("npx ctx7 add https://github.com/owner/repo")}`);
  console.log("");

  console.log(
    `  Run ${brand.primary("npx ctx7 --help")} (or ${brand.primary("context7 --help")}) for all commands and options`
  );
  console.log("");
});

await program.parseAsync();
