#!/usr/bin/env node
/**
 * Build a portable Windows zip for winget (Node dependency via OpenJS.NodeJS.LTS).
 *
 * Layout:
 *   context7-win-portable/
 *     context7.cmd
 *     ctx7.cmd
 *     package.json
 *     dist/
 *     node_modules/  (production deps only)
 */
import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(pkgRoot, "../..");
const outDir = path.resolve(pkgRoot, "dist-portable");
const stagingName = "context7-win-portable";

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function writeLauncher(dir, name) {
  const content = `@echo off\r
setlocal\r
where node >nul 2>nul\r
if errorlevel 1 (\r
  echo Node.js is required. Install with: winget install OpenJS.NodeJS.LTS\r
  exit /b 1\r
)\r
node "%~dp0dist\\index.js" %*\r
`;
  writeFileSync(path.join(dir, `${name}.cmd`), content, "utf8");
}

const pkg = JSON.parse(readFileSync(path.join(pkgRoot, "package.json"), "utf8"));
const version = pkg.version;

console.log(`Building CLI...`);
run("pnpm", ["--filter", "ctx7", "build"], repoRoot);

const stagingRoot = mkdtempSync(path.join(tmpdir(), "ctx7-portable-"));
const staging = path.join(stagingRoot, stagingName);
mkdirSync(staging, { recursive: true });

cpSync(path.join(pkgRoot, "dist"), path.join(staging, "dist"), { recursive: true });
writeFileSync(
  path.join(staging, "package.json"),
  JSON.stringify(
    {
      name: pkg.name,
      version: pkg.version,
      type: "module",
      private: true,
      dependencies: pkg.dependencies,
    },
    null,
    2
  )
);

console.log("Installing production dependencies into portable package...");
run("npm", ["install", "--omit=dev", "--ignore-scripts"], staging);

writeLauncher(staging, "context7");
writeLauncher(staging, "ctx7");
writeFileSync(
  path.join(staging, "README.txt"),
  `Context7 CLI ${version} (portable)\r
\r
Requires Node.js 18+ on PATH (winget install OpenJS.NodeJS.LTS).\r
Commands: context7.cmd and ctx7.cmd\r
`
);

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const zipPath = path.join(outDir, `context7-${version}-win-portable.zip`);
if (existsSync(zipPath)) rmSync(zipPath);

console.log(`Creating ${zipPath}...`);
if (process.platform === "win32") {
  run(
    "powershell",
    [
      "-NoProfile",
      "-Command",
      `Compress-Archive -Path '${staging.replace(/'/g, "''")}' -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force`,
    ],
    stagingRoot
  );
} else {
  run("zip", ["-r", zipPath, stagingName], stagingRoot);
}

rmSync(stagingRoot, { recursive: true, force: true });
console.log(`Wrote ${zipPath}`);
