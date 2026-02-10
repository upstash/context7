import pc from "picocolors";
import { select, confirm } from "@inquirer/prompts";
import { access } from "fs/promises";
import { join, dirname } from "path";
import { homedir } from "os";

import { log } from "./logger.js";
import { checkboxWithHover } from "./prompts.js";
import type {
  IDE,
  IDEOptions,
  Scope,
  AddOptions,
  ListOptions,
  RemoveOptions,
  InstallTargets,
} from "../types.js";
import {
  IDE_PATHS,
  IDE_GLOBAL_PATHS,
  IDE_NAMES,
  UNIVERSAL_SKILLS_PATH,
  UNIVERSAL_SKILLS_GLOBAL_PATH,
  UNIVERSAL_AGENTS,
  UNIVERSAL_AGENTS_LABEL,
  VENDOR_SPECIFIC_AGENTS,
  DEFAULT_CONFIG,
} from "../types.js";

export function getSelectedIdes(options: IDEOptions): IDE[] {
  const ides: IDE[] = [];
  if (options.claude) ides.push("claude");
  if (options.cursor) ides.push("cursor");
  if (options.universal) ides.push("universal");
  if (options.antigravity) ides.push("antigravity");
  return ides;
}

export function hasExplicitIdeOption(options: IDEOptions): boolean {
  return !!(options.claude || options.cursor || options.universal || options.antigravity);
}

/** Detect vendor-specific agents whose parent directory exists. */
async function detectVendorSpecificAgents(scope: Scope): Promise<IDE[]> {
  const baseDir = scope === "global" ? homedir() : process.cwd();
  const pathMap = scope === "global" ? IDE_GLOBAL_PATHS : IDE_PATHS;
  const detected: IDE[] = [];

  for (const ide of VENDOR_SPECIFIC_AGENTS) {
    const parentDir = dirname(pathMap[ide]);
    try {
      await access(join(baseDir, parentDir));
      detected.push(ide);
    } catch {}
  }

  return detected;
}

export function getUniversalDir(scope: Scope): string {
  if (scope === "global") {
    return join(homedir(), UNIVERSAL_SKILLS_GLOBAL_PATH);
  }
  return join(process.cwd(), UNIVERSAL_SKILLS_PATH);
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

  const scope: Scope = options.global ? "global" : "project";
  const baseDir = scope === "global" ? homedir() : process.cwd();
  const pathMap = scope === "global" ? IDE_GLOBAL_PATHS : IDE_PATHS;
  const universalPath = scope === "global" ? UNIVERSAL_SKILLS_GLOBAL_PATH : UNIVERSAL_SKILLS_PATH;

  // Detect universal (.agents/) and vendor-specific agent directories
  const detectedVendor = await detectVendorSpecificAgents(scope);
  let hasUniversalDir = false;
  try {
    await access(join(baseDir, dirname(universalPath)));
    hasUniversalDir = true;
  } catch {}

  const detectedIdes: IDE[] = [
    ...(hasUniversalDir ? (["universal"] as IDE[]) : []),
    ...detectedVendor,
  ];

  if (detectedIdes.length > 0) {
    // Detected — just confirm
    const pathLines: string[] = [];
    if (hasUniversalDir) {
      pathLines.push(join(baseDir, universalPath));
    }
    for (const ide of detectedVendor) {
      pathLines.push(join(baseDir, pathMap[ide]));
    }

    log.blank();

    let confirmed: boolean;
    try {
      confirmed = await confirm({
        message: `Install to detected location(s)?\n${pc.dim(pathLines.join("\n"))}`,
        default: true,
      });
    } catch {
      return null;
    }

    if (!confirmed) {
      log.warn("Installation cancelled");
      return null;
    }

    return { ides: detectedIdes, scopes: [scope] };
  }

  // Nothing detected — show checkbox to pick
  const universalLabel = `Universal \u2014 ${UNIVERSAL_AGENTS_LABEL} ${pc.dim(`(${universalPath})`)}`;
  const choices: { name: string; value: IDE; checked: boolean }[] = [
    { name: universalLabel, value: "universal", checked: true },
  ];

  for (const ide of VENDOR_SPECIFIC_AGENTS) {
    choices.push({
      name: `${IDE_NAMES[ide]} ${pc.dim(`(${pathMap[ide]})`)}`,
      value: ide,
      checked: false,
    });
  }

  log.blank();

  let selectedIdes: IDE[];
  try {
    selectedIdes = await checkboxWithHover(
      {
        message: `Which agents do you want to install to?\n${pc.dim(`  ${baseDir}`)}`,
        choices,
        loop: false,
        theme: {
          style: {
            highlight: (text: string) => pc.green(text),
            message: (text: string, status: string) => {
              if (status === "done") return pc.dim(text.split("\n")[0]);
              return pc.bold(text);
            },
          },
        },
      },
      { getName: (ide: IDE) => IDE_NAMES[ide] }
    );
  } catch {
    return null;
  }

  // Universal is always included
  const ides: IDE[] = ["universal", ...selectedIdes.filter((ide) => ide !== "universal")];

  return { ides, scopes: [scope] };
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

  const universalLabel = `Universal ${pc.dim(`(${UNIVERSAL_SKILLS_PATH})`)}`;
  const choices: { name: string; value: IDE }[] = [{ name: universalLabel, value: "universal" }];

  for (const ide of VENDOR_SPECIFIC_AGENTS) {
    choices.push({
      name: `${IDE_NAMES[ide]} ${pc.dim(`(${IDE_PATHS[ide]})`)}`,
      value: ide,
    });
  }

  let selectedIde: IDE;
  try {
    selectedIde = await select({
      message: "Which location?",
      choices,
      default: DEFAULT_CONFIG.defaultIde,
      loop: false,
      theme: { style: { highlight: (text: string) => pc.green(text) } },
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
        loop: false,
        theme: { style: { highlight: (text: string) => pc.green(text) } },
      });
    } catch {
      return null;
    }
  }

  return { ide: selectedIde, scope: selectedScope };
}

export function getTargetDirs(targets: InstallTargets): string[] {
  const hasUniversal = targets.ides.some((ide) => UNIVERSAL_AGENTS.has(ide));
  const dirs: string[] = [];

  for (const scope of targets.scopes) {
    const baseDir = scope === "global" ? homedir() : process.cwd();

    if (hasUniversal) {
      const uniPath = scope === "global" ? UNIVERSAL_SKILLS_GLOBAL_PATH : UNIVERSAL_SKILLS_PATH;
      dirs.push(join(baseDir, uniPath));
    }

    for (const ide of targets.ides) {
      if (UNIVERSAL_AGENTS.has(ide)) continue;
      const pathMap = scope === "global" ? IDE_GLOBAL_PATHS : IDE_PATHS;
      dirs.push(join(baseDir, pathMap[ide]));
    }
  }

  return dirs;
}

export function getTargetDirFromSelection(ide: IDE, scope: Scope): string {
  if (UNIVERSAL_AGENTS.has(ide)) {
    return getUniversalDir(scope);
  }
  if (scope === "global") {
    return join(homedir(), IDE_GLOBAL_PATHS[ide]);
  }
  return join(process.cwd(), IDE_PATHS[ide]);
}
