import { Command } from "commander";
import pc from "picocolors";
import figlet from "figlet";
import { registerSkillCommands, registerSkillAliases } from "./commands/skill.js";
import { setBaseUrl } from "./utils/api.js";
import { VERSION } from "./constants.js";

const brand = {
  primary: pc.green,
  dim: pc.dim,
};

const program = new Command();

program
  .name("ctx7")
  .description("Context7 CLI - Manage AI coding skills and documentation context")
  .version(VERSION)
  .option("--base-url <url>")
  .hook("preAction", (thisCommand) => {
    const opts = thisCommand.opts();
    if (opts.baseUrl) {
      setBaseUrl(opts.baseUrl);
    }
  })
  .addHelpText(
    "after",
    `
Examples:
  ${brand.dim("# Search for skills")}
  ${brand.primary("npx ctx7 skills search pdf")}
  ${brand.primary("npx ctx7 skills search react hooks")}

  ${brand.dim("# Install from a repository")}
  ${brand.primary("npx ctx7 skills install /anthropics/skills")}
  ${brand.primary("npx ctx7 skills install /anthropics/skills pdf")}

  ${brand.dim("# Install to specific client")}
  ${brand.primary("npx ctx7 skills install /anthropics/skills --cursor")}
  ${brand.primary("npx ctx7 skills install /anthropics/skills --global")}

  ${brand.dim("# List and manage installed skills")}
  ${brand.primary("npx ctx7 skills list --claude")}
  ${brand.primary("npx ctx7 skills remove pdf")}

Visit ${brand.primary("https://context7.com")} to browse skills
`
  );

registerSkillCommands(program);
registerSkillAliases(program);

program.action(() => {
  console.log("");
  const banner = figlet.textSync("Context7", { font: "ANSI Shadow" });
  console.log(brand.primary(banner));
  console.log(brand.dim("  The open agent skills ecosystem"));
  console.log("");

  console.log("  Quick start:");
  console.log(`    ${brand.primary("npx ctx7 skills search pdf")}`);
  console.log(`    ${brand.primary("npx ctx7 skills install /anthropics/skills")}`);
  console.log("");

  console.log(`  Run ${brand.primary("npx ctx7 --help")} for all commands and options`);
  console.log(`  Visit ${brand.primary("https://context7.com")} to browse skills`);
  console.log("");
});

program.parse();
