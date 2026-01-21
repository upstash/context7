import { config } from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { Command } from "commander";
import chalk from "chalk";
import figlet from "figlet";
import { registerSkillCommands, registerSkillAliases } from "./commands/skill.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

config({ path: join(__dirname, "..", ".env") });

const brand = {
  primary: chalk.hex("#059669"),
  dark: chalk.hex("#292524"),
  light: chalk.hex("#fafaf9"),
  dim: chalk.hex("#78716c"),
};

const program = new Command();

program
  .name("ctx7")
  .description("Context7 CLI - Manage AI coding skills and documentation context")
  .version("0.1.0");

registerSkillCommands(program);
registerSkillAliases(program);

program.action(() => {
  console.log("");
  const banner = figlet.textSync("Context7", { font: "ANSI Shadow" });
  console.log(brand.primary(banner));
  console.log(brand.dim("  The open agent skills ecosystem"));
  console.log("");
  console.log("  Commands:");
  console.log(
    brand.primary("    ctx7 skills install <input>") + " Install skills from a repository"
  );
  console.log(brand.primary("    ctx7 skills search <query>") + "  Search for skills");
  console.log(brand.primary("    ctx7 skills list") + "            List installed skills");
  console.log(brand.primary("    ctx7 skills info <repo>") + "     Show skill information");
  console.log(brand.primary("    ctx7 skills remove <name>") + "   Remove a skill");
  console.log("");
  console.log("  Examples:");
  console.log(brand.dim("    ctx7 skills install /anthropics/skills"));
  console.log(brand.dim("    ctx7 skills install /anthropics/skills pdf --cursor"));
  console.log(brand.dim("    ctx7 skills search pdf"));
  console.log("");
  console.log(`  Run ${brand.primary("ctx7 --help")} for more information`);
  console.log("");
});

program.parse();
