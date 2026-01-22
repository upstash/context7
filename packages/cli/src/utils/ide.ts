import pc from "picocolors";
import { select, checkbox, confirm } from "@inquirer/prompts";
import { access } from "fs/promises";
import { join } from "path";
import { homedir } from "os";

import { log } from "./logger.js";
import type {
  IDE,
  IDEOptions,
  Scope,
  AddOptions,
  ListOptions,
  RemoveOptions,
  InstallTargets,
} from "../types.js";
import { IDE_PATHS, IDE_GLOBAL_PATHS, IDE_NAMES, DEFAULT_CONFIG } from "../types.js";
import { dirname } from "path";

export function getSelectedIdes(options: IDEOptions): IDE[] {
  const ides: IDE[] = [];
  if (options.claude) ides.push("claude");
  if (options.cursor) ides.push("cursor");
  if (options.codex) ides.push("codex");
  if (options.opencode) ides.push("opencode");
  if (options.amp) ides.push("amp");
  if (options.antigravity) ides.push("antigravity");
  return ides;
}

export function hasExplicitIdeOption(options: IDEOptions): boolean {
  return !!(
    options.claude ||
    options.cursor ||
    options.codex ||
    options.opencode ||
    options.amp ||
    options.antigravity
  );
}

interface DetectedIdes {
  ides: IDE[];
  scope: Scope;
}

export async function detectInstalledIdes(preferredScope?: Scope): Promise<DetectedIdes | null> {
  const allIdes = Object.keys(IDE_PATHS) as IDE[];

  if (preferredScope === "global") {
    const globalIdes: IDE[] = [];
    for (const ide of allIdes) {
      const detectionPath = dirname(IDE_GLOBAL_PATHS[ide]);
      const globalParent = join(homedir(), detectionPath);
      try {
        await access(globalParent);
        globalIdes.push(ide);
      } catch {}
    }
    if (globalIdes.length > 0) {
      return { ides: globalIdes, scope: "global" };
    }
    return null;
  }

  const projectIdes: IDE[] = [];
  for (const ide of allIdes) {
    const detectionPath = dirname(IDE_PATHS[ide]);
    const projectParent = join(process.cwd(), detectionPath);
    try {
      await access(projectParent);
      projectIdes.push(ide);
    } catch {}
  }

  if (projectIdes.length > 0) {
    return { ides: projectIdes, scope: "project" };
  }

  return null;
}

export async function promptForInstallTargets(options: AddOptions): Promise<InstallTargets | null> {
  if (hasExplicitIdeOption(options)) {
    const ides = getSelectedIdes(options);
    const scope: Scope = options.global ? "global" : "project";
    return {
      ides: ides.length > 0 ? ides : [DEFAULT_CONFIG.defaultIde],
      scopes: [scope],
    };
  }

  const preferredScope: Scope | undefined = options.global ? "global" : undefined;
  const detected = await detectInstalledIdes(preferredScope);

  if (detected) {
    const scope: Scope = options.global ? "global" : detected.scope;
    const pathMap = scope === "global" ? IDE_GLOBAL_PATHS : IDE_PATHS;
    const baseDir = scope === "global" ? homedir() : process.cwd();

    const paths = detected.ides.map((ide) => join(baseDir, pathMap[ide]));
    const pathList = paths.join("\n");

    log.blank();
    let confirmed: boolean;
    try {
      confirmed = await confirm({
        message: `Install to detected location(s)?\n${pc.dim(pathList)}`,
        default: true,
      });
    } catch {
      return null;
    }

    if (!confirmed) {
      log.warn("Installation cancelled");
      return null;
    }

    return { ides: detected.ides, scopes: [scope] };
  }

  // No IDE detected - prompt user to select which client(s) to install for
  log.blank();

  const scope: Scope = options.global ? "global" : "project";
  const pathMap = scope === "global" ? IDE_GLOBAL_PATHS : IDE_PATHS;
  const baseDir = scope === "global" ? homedir() : process.cwd();

  const ideChoices = (Object.keys(IDE_NAMES) as IDE[]).map((ide) => ({
    name: `${IDE_NAMES[ide]} ${pc.dim(`(${pathMap[ide]})`)}`,
    value: ide,
    checked: ide === DEFAULT_CONFIG.defaultIde,
  }));

  let selectedIdes: IDE[];
  try {
    selectedIdes = await checkbox({
      message: `Which clients do you want to install the skill(s) for?\n${pc.dim(baseDir)}`,
      choices: ideChoices,
      required: true,
    });
  } catch {
    return null;
  }

  if (selectedIdes.length === 0) {
    log.warn("You must select at least one client");
    return null;
  }

  return { ides: selectedIdes, scopes: [scope] };
}

export async function promptForSingleTarget(
  options: ListOptions | RemoveOptions
): Promise<{ ide: IDE; scope: Scope } | null> {
  if (hasExplicitIdeOption(options)) {
    const ides = getSelectedIdes(options);
    const ide = ides[0] || DEFAULT_CONFIG.defaultIde;
    const scope: Scope = options.global ? "global" : "project";
    return { ide, scope };
  }

  log.blank();

  const ideChoices = (Object.keys(IDE_NAMES) as IDE[]).map((ide) => ({
    name: `${IDE_NAMES[ide]} ${pc.dim(`(${IDE_PATHS[ide]})`)}`,
    value: ide,
  }));

  let selectedIde: IDE;
  try {
    selectedIde = await select({
      message: "Which client?",
      choices: ideChoices,
      default: DEFAULT_CONFIG.defaultIde,
    });
  } catch {
    return null;
  }

  let selectedScope: Scope;
  if (options.global !== undefined) {
    selectedScope = options.global ? "global" : "project";
  } else {
    try {
      selectedScope = await select({
        message: "Which scope?",
        choices: [
          {
            name: `Project ${pc.dim("(current directory)")}`,
            value: "project" as Scope,
          },
          {
            name: `Global ${pc.dim("(home directory)")}`,
            value: "global" as Scope,
          },
        ],
        default: DEFAULT_CONFIG.defaultScope,
      });
    } catch {
      return null;
    }
  }

  return { ide: selectedIde, scope: selectedScope };
}

export function getTargetDirs(targets: InstallTargets): string[] {
  // Prioritize Claude to receive original files (others get symlinks)
  const sortedIdes = [...targets.ides].sort((a, b) => {
    if (a === "claude") return -1;
    if (b === "claude") return 1;
    return 0;
  });

  const dirs: string[] = [];
  for (const ide of sortedIdes) {
    for (const scope of targets.scopes) {
      if (scope === "global") {
        dirs.push(join(homedir(), IDE_GLOBAL_PATHS[ide]));
      } else {
        dirs.push(join(process.cwd(), IDE_PATHS[ide]));
      }
    }
  }
  return dirs;
}

export function getTargetDirFromSelection(ide: IDE, scope: Scope): string {
  if (scope === "global") {
    return join(homedir(), IDE_GLOBAL_PATHS[ide]);
  }
  return join(process.cwd(), IDE_PATHS[ide]);
}
