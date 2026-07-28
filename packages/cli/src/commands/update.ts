import { Command } from "commander";
import { dirname } from "path";
import ora from "ora";
import pc from "picocolors";
import { confirm } from "@inquirer/prompts";

import { VERSION } from "../constants.js";
import { log } from "../utils/logger.js";
import { trackEvent } from "../utils/tracking.js";
import {
  forgetInstall,
  readCliState,
  updateCliState,
  type Install,
  type SkillInstall,
} from "../utils/cli-state.js";
import { getManifest, hashContent, hashFiles, supportsEntry } from "../utils/content.js";
import { readSkillFiles } from "../utils/installer.js";
import { installSkill } from "../setup/skills.js";
import { installRule, readRuleBody } from "../setup/rules.js";
import { getRule } from "../setup/templates.js";
import { SETUP_AGENT_NAMES, type SetupAgent } from "../setup/agents.js";

const NOTICE_COOLDOWN_MS = 24 * 60 * 60 * 1000;

interface UpdateOptions {
  yes?: boolean;
  check?: boolean;
  force?: boolean;
  json?: boolean;
}

interface Outdated {
  path: string;
  install: Install;
  latest: number;
  edited: boolean;
  blockedBy?: string;
}

export function registerUpdateCommand(program: Command): void {
  program
    .command("update")
    .description("Update installed Context7 skills and rules to the latest content")
    .option("-y, --yes", "Apply updates without prompting")
    .option("--check", "Only report what is outdated")
    .option("--force", "Overwrite locally modified skills and rules")
    .option("--json", "Output as JSON")
    .action(async (options: UpdateOptions) => {
      await updateCommand(options);
    });
}

async function readSkillHash(path: string, install: SkillInstall): Promise<string | null> {
  const files = await readSkillFiles(path, install.files);
  return files ? hashFiles(files) : null;
}

export async function scanOutdated(): Promise<Outdated[]> {
  const manifest = await getManifest();
  if (!manifest) return [];

  const installs = (await readCliState()).installs ?? {};
  const outdated: Outdated[] = [];

  for (const [path, install] of Object.entries(installs)) {
    const entry =
      install.kind === "skill" ? manifest.skills?.[install.name] : manifest.rules?.[install.name];
    if (!entry) continue;

    const current =
      install.kind === "skill"
        ? await readSkillHash(path, install)
        : await readRuleBody(install.agent as SetupAgent, path).then((body) =>
            body === null ? null : hashContent(body)
          );

    if (current === null) {
      await forgetInstall(path);
      continue;
    }

    if (entry.revision <= install.revision) continue;

    outdated.push({
      path,
      install,
      latest: entry.revision,
      edited: current !== install.hash,
      blockedBy: supportsEntry(entry) ? undefined : entry.minCliVersion,
    });
  }

  return outdated;
}

async function apply(target: Outdated): Promise<void> {
  const agent = target.install.agent as SetupAgent;

  if (target.install.kind === "skill") {
    await installSkill(agent, target.install.scope, target.install.name, dirname(target.path));
    return;
  }

  const { content, revision } = await getRule(target.install.mode, agent);
  await installRule(
    agent,
    target.install.mode,
    target.install.scope,
    content,
    revision,
    target.path
  );
}

function label(target: Outdated): string {
  const agent = SETUP_AGENT_NAMES[target.install.agent as SetupAgent] ?? target.install.agent;
  const kind = target.install.kind === "skill" ? "Skill" : "Rule";
  return `${kind} ${pc.bold(target.install.name)} ${pc.dim(`(${agent}, ${target.install.scope})`)}`;
}

async function updateCommand(options: UpdateOptions): Promise<void> {
  trackEvent("command", { name: "update" });

  const outdated = await scanOutdated();

  if (options.json) {
    log.plain(
      JSON.stringify(
        outdated.map((target) => ({
          path: target.path,
          kind: target.install.kind,
          name: target.install.name,
          agent: target.install.agent,
          scope: target.install.scope,
          installedRevision: target.install.revision,
          latestRevision: target.latest,
          edited: target.edited,
          blockedBy: target.blockedBy ?? null,
        })),
        null,
        2
      )
    );
    return;
  }

  if (outdated.length === 0) {
    log.success("Context7 skills and rules are up to date.");
    return;
  }

  const blocked = outdated.filter((target) => target.blockedBy);
  const edited = outdated.filter((target) => !target.blockedBy && target.edited && !options.force);
  const ready = outdated.filter((target) => !target.blockedBy && (options.force || !target.edited));

  log.blank();
  for (const target of ready) {
    log.plain(
      `  ${pc.green("+")} ${label(target)} ${pc.dim(`r${target.install.revision} ->`)} ${pc.green(`r${target.latest}`)}`
    );
    log.plain(`    ${pc.dim(target.path)}`);
  }
  for (const target of edited) {
    log.plain(`  ${pc.yellow("~")} ${label(target)} ${pc.yellow("modified locally, skipping")}`);
    log.plain(`    ${pc.dim(target.path)}`);
  }
  for (const target of blocked) {
    log.plain(`  ${pc.dim("~")} ${label(target)} ${pc.dim(`needs ctx7 >= ${target.blockedBy}`)}`);
  }
  log.blank();

  if (edited.length > 0) {
    log.dim(`Run with ${pc.cyan("--force")} to overwrite locally modified files.`);
  }
  if (blocked.length > 0) {
    log.dim(`You are on v${VERSION}. Run ${pc.cyan("ctx7 upgrade")} to unlock newer content.`);
  }

  if (ready.length === 0 || options.check) return;

  let shouldRun = options.yes ?? false;
  if (!shouldRun && process.stdout.isTTY) {
    shouldRun = await confirm({ message: `Update ${ready.length} item(s)?`, default: true });
  }
  if (!shouldRun) {
    log.dim("Update skipped.");
    return;
  }

  log.blank();
  const spinner = ora("Updating...").start();
  const failures: string[] = [];

  for (const target of ready) {
    spinner.text = `Updating ${target.install.name}...`;
    try {
      await apply(target);
    } catch (err) {
      failures.push(`${target.install.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  spinner.succeed(`Updated ${ready.length - failures.length} of ${ready.length} item(s)`);

  for (const failure of failures) {
    log.error(failure);
  }

  trackEvent("content-update", { count: ready.length - failures.length });
}

export async function maybeShowContentUpdateNotice(
  options: { actionName?: string; argv?: string[]; isInteractive?: boolean; now?: number } = {}
): Promise<void> {
  const actionName = options.actionName ?? "";
  const argv = options.argv ?? process.argv;
  const isInteractive =
    options.isInteractive ?? Boolean(process.stdout.isTTY && process.stdin.isTTY);

  if (
    !isInteractive ||
    argv.includes("--json") ||
    ["update", "setup", "remove", "uninstall", "upgrade"].includes(actionName)
  ) {
    return;
  }

  const now = options.now ?? Date.now();
  const state = await readCliState();
  if (state.contentNotifiedAt && now - state.contentNotifiedAt < NOTICE_COOLDOWN_MS) return;

  const actionable = (await scanOutdated()).filter((target) => !target.blockedBy);
  if (actionable.length === 0) return;

  log.blank();
  log.box([
    `${pc.white(pc.bold("Skill update available:"))} ${pc.green(pc.bold(String(actionable.length)))} ${pc.white("item(s) out of date")}`,
    `${pc.white("Run")} ${pc.yellow(pc.bold("ctx7 update"))} ${pc.white("to refresh them")}`,
  ]);
  log.blank();

  await updateCliState({ contentNotifiedAt: now });
}
