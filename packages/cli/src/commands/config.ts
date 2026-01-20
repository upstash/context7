import { Command } from "commander";
import * as p from "@clack/prompts";
import pc from "picocolors";
import { loadConfig, saveConfig, getConfigPath } from "../utils/config.js";
import type { IDE, C7Config } from "../types.js";
import { IDE_NAMES, IDE_PATHS } from "../types.js";
import { homedir } from "os";
import { join } from "path";

const IDE_OPTIONS: IDE[] = ["claude", "cursor", "codex", "opencode", "amp", "antigravity"];

export function registerConfigCommands(program: Command): void {
  const config = program.command("config").description("Manage c7 configuration");

  config
    .command("edit")
    .description("Edit configuration interactively")
    .action(async () => {
      await editConfig();
    });

  config
    .command("show")
    .description("Show current configuration")
    .action(async () => {
      await showConfig();
    });

  config
    .command("path")
    .description("Show configuration file path")
    .action(() => {
      console.log(getConfigPath());
    });

  config
    .command("set")
    .argument("<key>", "Configuration key (defaultIde, defaultScope)")
    .argument("<value>", "Value to set")
    .description("Set a configuration value")
    .action(async (key: string, value: string) => {
      await setConfigValue(key, value);
    });
}

async function editConfig(): Promise<void> {
  p.intro(pc.cyan("Configure c7"));

  const currentConfig = await loadConfig();

  const ide = await p.select({
    message: "Default IDE:",
    options: IDE_OPTIONS.map((id) => ({
      value: id,
      label: IDE_NAMES[id],
      hint: id === currentConfig.defaultIde ? "(current)" : undefined,
    })),
    initialValue: currentConfig.defaultIde,
  });

  if (p.isCancel(ide)) {
    p.cancel("Configuration cancelled");
    return;
  }

  const scope = await p.select({
    message: "Default scope:",
    options: [
      { value: "project", label: "Project", hint: "Install skills in current directory" },
      { value: "global", label: "Global", hint: "Install skills in home directory" },
    ],
    initialValue: currentConfig.defaultScope,
  });

  if (p.isCancel(scope)) {
    p.cancel("Configuration cancelled");
    return;
  }

  const newConfig: C7Config = {
    defaultIde: ide as IDE,
    defaultScope: scope as "project" | "global",
  };

  await saveConfig(newConfig);

  const idePath = IDE_PATHS[newConfig.defaultIde];
  const skillsPath =
    newConfig.defaultScope === "global"
      ? join(homedir(), idePath)
      : `./${idePath}`;

  p.note(
    `Default IDE: ${pc.green(IDE_NAMES[newConfig.defaultIde])}\nDefault scope: ${pc.green(newConfig.defaultScope)}\nSkills path: ${pc.green(skillsPath)}`,
    "Configuration saved"
  );

  p.outro(`Config saved to ${pc.dim(getConfigPath())}`);
}

async function showConfig(): Promise<void> {
  const config = await loadConfig();
  const idePath = IDE_PATHS[config.defaultIde];
  const skillsPath =
    config.defaultScope === "global"
      ? join(homedir(), idePath)
      : `./${idePath}`;

  console.log("");
  console.log(pc.cyan("Current configuration:"));
  console.log("");
  console.log(`  ${pc.dim("Default IDE:")}     ${pc.green(IDE_NAMES[config.defaultIde])}`);
  console.log(`  ${pc.dim("Default scope:")}   ${pc.green(config.defaultScope)}`);
  console.log(`  ${pc.dim("Skills path:")}     ${pc.green(skillsPath)}`);
  console.log("");
  console.log(pc.dim(`  Config file: ${getConfigPath()}`));
  console.log("");
}

async function setConfigValue(key: string, value: string): Promise<void> {
  const config = await loadConfig();

  if (key === "defaultIde") {
    if (!IDE_OPTIONS.includes(value as IDE)) {
      p.log.error(`Invalid IDE. Options: ${IDE_OPTIONS.join(", ")}`);
      return;
    }
    config.defaultIde = value as IDE;
  } else if (key === "defaultScope") {
    if (value !== "project" && value !== "global") {
      p.log.error("Invalid scope. Options: project, global");
      return;
    }
    config.defaultScope = value;
  } else {
    p.log.error(`Unknown config key: ${key}. Options: defaultIde, defaultScope`);
    return;
  }

  await saveConfig(config);
  p.log.success(`Set ${key} = ${value}`);
}
