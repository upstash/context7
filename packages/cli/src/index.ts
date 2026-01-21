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
  });

registerSkillCommands(program);
registerSkillAliases(program);

program.action(() => {
  console.log("");
  const banner = figlet.textSync("Context7", { font: "ANSI Shadow" });
  console.log(brand.primary(banner));
  console.log(brand.dim("  The open agent skills ecosystem"));
  console.log("");

  console.log("  Commands:");
  console.log(brand.primary("    skills install") + "  Install skills from a GitHub repository");
  console.log(brand.primary("    skills search") + "   Search for skills across all repositories");
  console.log(brand.primary("    skills list") + "     List installed skills");
  console.log(brand.primary("    skills remove") + "   Remove an installed skill");
  console.log(brand.primary("    skills info") + "     Show skills in a repository");
  console.log("");

  console.log("  Examples:");
  console.log("");
  console.log(brand.dim("    # Search for skills"));
  console.log(`    ${brand.primary("npx ctx7 skills search pdf")}`);
  console.log(`    ${brand.primary("npx ctx7 skills search react hooks")}`);
  console.log("");
  console.log(brand.dim("    # Install from a repository"));
  console.log(`    ${brand.primary("npx ctx7 skills install /anthropics/skills")}`);
  console.log(`    ${brand.primary("npx ctx7 skills install /anthropics/skills pdf")}`);
  console.log("");
  console.log(brand.dim("    # Install to specific client"));
  console.log(`    ${brand.primary("npx ctx7 skills install /anthropics/skills --cursor")}`);
  console.log(`    ${brand.primary("npx ctx7 skills install /anthropics/skills --global")}`);
  console.log("");
  console.log(brand.dim("    # List and manage installed skills"));
  console.log(`    ${brand.primary("npx ctx7 skills list --claude")}`);
  console.log(`    ${brand.primary("npx ctx7 skills remove pdf")}`);
  console.log("");

  console.log(`  Run ${brand.primary("npx ctx7 --help")} for all options`);
  console.log(`  Visit ${brand.primary("https://context7.com")} to browse skills`);
  console.log("");
});

program.parse();
