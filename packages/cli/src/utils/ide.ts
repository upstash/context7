import pc from "picocolors";
import { select, checkbox } from "@inquirer/prompts";
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
import { IDE_PATHS, IDE_NAMES, DEFAULT_CONFIG } from "../types.js";

export function getSelectedIde(options: IDEOptions): IDE | null {
  if (options.claude) return "claude";
  if (options.cursor) return "cursor";
  if (options.codex) return "codex";
  if (options.opencode) return "opencode";
  if (options.amp) return "amp";
  if (options.antigravity) return "antigravity";
  return null;
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

export async function detectInstalledIdes(): Promise<DetectedIdes | null> {
  const allIdes = Object.keys(IDE_PATHS) as IDE[];

  const projectIdes: IDE[] = [];
  for (const ide of allIdes) {
    const idePath = IDE_PATHS[ide];
    const projectParent = join(process.cwd(), idePath.split("/")[0]);
    try {
      await access(projectParent);
      projectIdes.push(ide);
    } catch {}
  }

  if (projectIdes.length > 0) {
    return { ides: projectIdes, scope: "project" };
  }

  const globalIdes: IDE[] = [];
  for (const ide of allIdes) {
    const idePath = IDE_PATHS[ide];
    const globalParent = join(homedir(), idePath.split("/")[0]);
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

export async function promptForInstallTargets(options: AddOptions): Promise<InstallTargets | null> {
  if (hasExplicitIdeOption(options)) {
    const ide = getSelectedIde(options);
    const scope: Scope = options.global ? "global" : "project";
    return {
      ides: [ide || DEFAULT_CONFIG.defaultIde],
      scopes: [scope],
    };
  }

  const detected = await detectInstalledIdes();

  if (detected) {
    const scope: Scope = options.global ? "global" : "project";
    return { ides: detected.ides, scopes: [scope] };
  }

  log.blank();

  const ideChoices = (Object.keys(IDE_NAMES) as IDE[]).map((ide) => ({
    name: `${IDE_NAMES[ide]} ${pc.dim(`(${IDE_PATHS[ide]})`)}`,
    value: ide,
    checked: ide === DEFAULT_CONFIG.defaultIde,
  }));

  let selectedIdes: IDE[];
  try {
    selectedIdes = await checkbox({
      message: "Which clients do you want to install the skill(s) for?",
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

  const selectedScopes: Scope[] = options.global ? ["global"] : ["project"];

  return { ides: selectedIdes, scopes: selectedScopes };
}

export async function promptForSingleTarget(
  options: ListOptions | RemoveOptions
): Promise<{ ide: IDE; scope: Scope } | null> {
  if (hasExplicitIdeOption(options)) {
    const ide = getSelectedIde(options) || DEFAULT_CONFIG.defaultIde;
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
  const dirs: string[] = [];
  for (const ide of targets.ides) {
    const idePath = IDE_PATHS[ide];
    for (const scope of targets.scopes) {
      if (scope === "global") {
        dirs.push(join(homedir(), idePath));
      } else {
        dirs.push(join(process.cwd(), idePath));
      }
    }
  }
  return dirs;
}

export function getTargetDirFromSelection(ide: IDE, scope: Scope): string {
  const idePath = IDE_PATHS[ide];
  if (scope === "global") {
    return join(homedir(), idePath);
  }
  return join(process.cwd(), idePath);
}
