import { confirm } from "@inquirer/prompts";
import { spawn } from "child_process";
import { Command } from "commander";
import pc from "picocolors";
import { VERSION } from "../constants.js";
import { log } from "../utils/logger.js";
import { trackEvent } from "../utils/tracking.js";
import {
  checkForUpdates,
  getUpgradePlan,
  markUpdateNotificationShown,
  shouldShowUpdateNotification,
  shouldSkipUpdateNotifier,
  type UpgradePlan,
} from "../utils/update-check.js";

interface UpgradeOptions {
  yes?: boolean;
  check?: boolean;
}

export function registerUpgradeCommand(program: Command): void {
  program
    .command("upgrade")
    .description("Check for a newer ctx7 version and upgrade when possible")
    .option("-y, --yes", "Run the suggested upgrade command without prompting")
    .option("--check", "Only check for updates without running the upgrade command")
    .action(async (options: UpgradeOptions) => {
      await upgradeCommand(options);
    });
}

function runCommand(command: string, args: string[]): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      shell: process.platform === "win32",
    });

    child.on("error", reject);
    child.on("close", (code) => resolve(code));
  });
}

export async function runUpgradePlan(plan: UpgradePlan): Promise<number | null> {
  return runCommand(plan.command, plan.args);
}

function showUpgradeFailureHelp(plan: UpgradePlan): void {
  log.info(`Try rerunning: ${pc.cyan(plan.displayCommand)}`);

  const isGlobalNpmInstall =
    (plan.installMethod === "npm-global" || plan.installMethod === "unknown") &&
    plan.command === "npm" &&
    plan.args.includes("-g");
  const isGlobalAltInstall =
    (plan.installMethod === "pnpm-global" || plan.installMethod === "bun-global") &&
    plan.args.includes("-g");

  if (isGlobalNpmInstall) {
    log.dim(
      "If this failed due to permissions, your global npm directory may require elevated privileges on this machine."
    );
  } else if (isGlobalAltInstall) {
    log.dim(
      "If this failed due to permissions, your global package manager install location may require additional privileges on this machine."
    );
  }
}

export async function maybeShowUpgradeNotice(
  options: {
    actionName?: string;
    argv?: string[];
    isInteractive?: boolean;
  } = {}
): Promise<void> {
  const actionName = options.actionName ?? "";
  const argv = options.argv ?? process.argv;
  const isInteractive =
    options.isInteractive ?? Boolean(process.stdout.isTTY && process.stdin.isTTY);

  if (!isInteractive || shouldSkipUpdateNotifier(argv) || actionName === "upgrade") {
    return;
  }

  const info = await checkForUpdates();
  if (!info || !info.updateAvailable || !(await shouldShowUpdateNotification(info))) {
    return;
  }

  log.blank();
  if (info.upgradePlan.needsExplicitVersion) {
    log.box([
      `${pc.white(pc.bold("Update available:"))} ${pc.green(pc.bold(`v${info.currentVersion}`))} ${pc.dim("->")} ${pc.green(pc.bold(`v${info.latestVersion}`))}`,
      `${pc.white("Use")} ${pc.yellow(pc.bold(info.upgradePlan.displayCommand))} ${pc.white("to run the latest version")}`,
    ]);
    await markUpdateNotificationShown(info.latestVersion);
    log.blank();
    return;
  }

  if (!info.upgradePlan.canRun) {
    log.box([
      `${pc.white(pc.bold("Update available:"))} ${pc.green(pc.bold(`v${info.currentVersion}`))} ${pc.dim("->")} ${pc.green(pc.bold(`v${info.latestVersion}`))}`,
      `${pc.white("Run")} ${pc.yellow(pc.bold("ctx7 upgrade"))} ${pc.white("for update steps")}`,
      `${pc.white("Or run")} ${pc.yellow(info.upgradePlan.displayCommand)}`,
    ]);
    await markUpdateNotificationShown(info.latestVersion);
    log.blank();
    return;
  }

  log.box([
    `${pc.white(pc.bold("Update available:"))} ${pc.green(pc.bold(`v${info.currentVersion}`))} ${pc.dim("->")} ${pc.green(pc.bold(`v${info.latestVersion}`))}`,
    `${pc.white("Run")} ${pc.yellow(pc.bold("ctx7 upgrade"))} ${pc.white("to update now")}`,
    `${pc.white("Or run")} ${pc.yellow(info.upgradePlan.displayCommand)}`,
  ]);
  await markUpdateNotificationShown(info.latestVersion);
  log.blank();
}

async function upgradeCommand(options: UpgradeOptions): Promise<void> {
  trackEvent("command", { name: "upgrade" });

  const info = await checkForUpdates({ force: true });
  const plan = info?.upgradePlan ?? getUpgradePlan();

  if (!info) {
    log.warn("Couldn't check for updates right now.");
    log.info(`Try again later or run ${pc.cyan(plan.displayCommand)} manually.`);
    return;
  }

  if (!info.updateAvailable) {
    log.success(`ctx7 is up to date (${pc.bold(`v${VERSION}`)})`);
    return;
  }

  log.blank();
  log.info(
    `Update available: ${pc.bold(`v${info.currentVersion}`)} ${pc.dim("->")} ${pc.bold(`v${info.latestVersion}`)}`
  );

  if (plan.needsExplicitVersion) {
    log.info(`You're using an ephemeral runner (${plan.installMethod}).`);
    log.info(`Use ${pc.cyan(plan.displayCommand)} to run the latest version immediately.`);
    log.info(`Or install globally with ${pc.cyan("npm install -g ctx7@latest")}.`);
    return;
  }

  if (!plan.canRun) {
    log.info(`Run ${pc.cyan(plan.displayCommand)} to update your installed version.`);
    return;
  }

  log.info(`Upgrade command: ${pc.cyan(plan.displayCommand)}`);

  if (options.check) {
    return;
  }

  let shouldRun = options.yes ?? false;
  if (!shouldRun && process.stdout.isTTY) {
    shouldRun = await confirm({
      message: `Run ${plan.displayCommand} now?`,
      default: true,
    });
  }

  if (!shouldRun) {
    log.dim("Upgrade skipped.");
    return;
  }

  log.blank();
  const exitCode = await runUpgradePlan(plan);

  if (exitCode === 0) {
    log.blank();
    log.success("Upgrade complete.");
    log.info(`Run ${pc.cyan("ctx7 --version")} to verify the installed version.`);
    return;
  }

  log.blank();
  log.error(`Upgrade command exited with code ${exitCode ?? "unknown"}.`);
  showUpgradeFailureHelp(plan);
  process.exitCode = 1;
}
