import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { Document, parseDocument } from "yaml";

export const DEEPSEEK_PLUGIN_PACKAGE = "@upstash/context7-deepseek-harness";
export const CONTEXT7_CREDENTIAL_REF = "CONTEXT7_API_KEY";

const CREDENTIAL_REF_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const PROFILE_PATTERN = /^[A-Za-z0-9._-]+$/;
const LOCK_RETRY_INITIAL_MS = 20;
const LOCK_RETRY_MAX_MS = 200;
const LOCK_TIMEOUT_MS = 2_000;

function isEnoent(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
}

function isEexist(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === "EEXIST";
}

export function resolveDshHome(
  env: NodeJS.ProcessEnv = process.env,
  userHome = homedir(),
  currentDirectory = process.cwd()
): string {
  const configured = env.DSH_HOME;
  const selected =
    configured !== undefined && configured.trim().length > 0 ? configured : join(userHome, ".dsh");
  const expanded =
    selected === "~"
      ? userHome
      : selected.startsWith("~/") || selected.startsWith("~\\")
        ? join(userHome, selected.slice(2))
        : selected;
  return resolve(currentDirectory, expanded);
}

function credentialsDocument(text: string | undefined, filename: string): Document {
  const document =
    text === undefined ? new Document({}) : parseDocument(text, { uniqueKeys: true });
  if (document.errors.length > 0) {
    throw new Error(`Invalid DeepSeek Harness credentials document at ${filename}`);
  }
  const root: unknown = document.toJS() ?? {};
  if (typeof root !== "object" || root === null || Array.isArray(root)) {
    throw new Error(`DeepSeek Harness credentials document at ${filename} must be a mapping`);
  }
  for (const [ref, value] of Object.entries(root as Record<string, unknown>)) {
    if (!CREDENTIAL_REF_PATTERN.test(ref)) {
      throw new Error(`Invalid credential reference "${ref}" in ${filename}`);
    }
    if (typeof value !== "string" || value.length === 0) {
      throw new Error(`Credential "${ref}" in ${filename} must have a non-empty string value`);
    }
  }
  return document;
}

async function withFileLock<T>(filename: string, operation: () => Promise<T>): Promise<T> {
  const lockPath = `${filename}.lock`;
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  let delay = LOCK_RETRY_INITIAL_MS;
  for (;;) {
    try {
      await writeFile(lockPath, `${process.pid}\n`, { mode: 0o600, flag: "wx" });
      break;
    } catch (error) {
      if (!isEexist(error)) throw error;
    }
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for the credential writer lock at ${lockPath}`);
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, delay));
    delay = Math.min(delay * 2, LOCK_RETRY_MAX_MS);
  }
  try {
    return await operation();
  } finally {
    await rm(lockPath, { force: true });
  }
}

export async function writeDeepSeekCredential(
  apiKey: string,
  dshHome = resolveDshHome()
): Promise<string> {
  if (!apiKey) throw new Error("Context7 API key cannot be empty");
  const filename = join(dshHome, ".credentials.yaml");
  await mkdir(dshHome, { recursive: true, mode: 0o700 });
  await chmod(dshHome, 0o700);
  await withFileLock(filename, async () => {
    let existing: string | undefined;
    try {
      existing = await readFile(filename, "utf8");
    } catch (error) {
      if (!isEnoent(error)) throw error;
    }
    const document = credentialsDocument(existing, filename);
    document.setIn([CONTEXT7_CREDENTIAL_REF], apiKey);
    const temporary = join(
      dshHome,
      `.credentials.yaml.${process.pid}.${randomBytes(6).toString("hex")}.tmp`
    );
    try {
      await writeFile(temporary, document.toString(), {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
      await chmod(temporary, 0o600);
      await rename(temporary, filename);
      await chmod(filename, 0o600);
    } finally {
      await unlink(temporary).catch((error: unknown) => {
        if (!isEnoent(error)) throw error;
      });
    }
  });
  return filename;
}

export function validateDeepSeekProfile(profile: string): string {
  if (
    !PROFILE_PATTERN.test(profile) ||
    profile === "." ||
    profile === ".." ||
    profile === "node_modules"
  ) {
    throw new Error(`Invalid DeepSeek Harness profile name "${profile}"`);
  }
  return profile;
}

export function deepSeekPluginInvocation(profile: string): {
  command: string;
  args: string[];
} {
  validateDeepSeekProfile(profile);
  return {
    command: "npx",
    args: [
      "--yes",
      "@deepseek-ai/dsh",
      "plugin",
      "--profile",
      profile,
      "add",
      DEEPSEEK_PLUGIN_PACKAGE,
    ],
  };
}

export async function installDeepSeekPlugin(profile: string): Promise<void> {
  const invocation = deepSeekPluginInvocation(profile);
  const code = await new Promise<number | null>((resolve, reject) => {
    const child = spawn(invocation.command, invocation.args, {
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    child.once("error", reject);
    child.once("close", resolve);
  }).catch((error: unknown) => {
    if (isEnoent(error)) {
      throw new Error("The `npx` package runner was not found on PATH");
    }
    throw error;
  });
  if (code !== 0) {
    throw new Error(`DeepSeek Harness plugin installation failed with exit code ${String(code)}`);
  }
}
