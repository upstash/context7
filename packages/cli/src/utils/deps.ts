import { readFile, readdir, stat } from "fs/promises";
import { join, resolve } from "path";

async function readFileOrNull(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf-8");
  } catch {
    return null;
  }
}

/** Basic client-side filter. The real SKIP_SET lives on the backend. */
function isSkippedLocally(name: string): boolean {
  return name.startsWith("@types/");
}

async function parsePackageJson(cwd: string): Promise<string[]> {
  const content = await readFileOrNull(join(cwd, "package.json"));
  if (!content) return [];

  try {
    const pkg = JSON.parse(content);
    const names = new Set<string>();

    for (const key of Object.keys(pkg.dependencies || {})) {
      if (!isSkippedLocally(key)) names.add(key);
    }
    for (const key of Object.keys(pkg.devDependencies || {})) {
      if (!isSkippedLocally(key)) names.add(key);
    }

    return [...names];
  } catch {
    return [];
  }
}

/**
 * Resolve workspace glob patterns into concrete directory paths.
 * Supports simple patterns like "packages/*" and "apps/*".
 * Does not pull in a full glob library — handles the common single-star case.
 */
async function resolveWorkspaceGlobs(cwd: string, patterns: string[]): Promise<string[]> {
  const dirs: string[] = [];

  for (const pattern of patterns) {
    // Strip trailing slashes
    const clean = pattern.replace(/\/+$/, "");

    if (clean.endsWith("/*")) {
      // e.g. "packages/*" → list all directories under packages/
      const parent = resolve(cwd, clean.slice(0, -2));
      try {
        const entries = await readdir(parent, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            dirs.push(join(parent, entry.name));
          }
        }
      } catch {
        // Parent doesn't exist — skip
      }
    } else if (!clean.includes("*")) {
      // Exact path like "tools/foo"
      const full = resolve(cwd, clean);
      try {
        const s = await stat(full);
        if (s.isDirectory()) dirs.push(full);
      } catch {
        // Doesn't exist — skip
      }
    }
    // More complex globs (e.g. "packages/**") are ignored for safety;
    // the common monorepo convention is "packages/*".
  }

  return dirs;
}

/**
 * Detect workspace package directories for JS/TS monorepos.
 * Checks pnpm-workspace.yaml first, then falls back to the
 * "workspaces" field in package.json (npm/yarn workspaces).
 */
async function getWorkspaceDirs(cwd: string): Promise<string[]> {
  // 1. pnpm workspaces
  const pnpmWs = await readFileOrNull(join(cwd, "pnpm-workspace.yaml"));
  if (pnpmWs) {
    // Simple YAML parsing for the packages array — avoids adding a YAML dep.
    // Handles:
    //   packages:
    //     - "packages/*"
    //     - "apps/*"
    const patterns: string[] = [];
    const lines = pnpmWs.split("\n");
    let inPackages = false;

    for (const line of lines) {
      const trimmed = line.trim();
      if (/^packages\s*:/.test(trimmed)) {
        inPackages = true;
        continue;
      }
      if (inPackages) {
        if (trimmed.startsWith("- ")) {
          const value = trimmed
            .slice(2)
            .trim()
            .replace(/^["']|["']$/g, "");
          if (value) patterns.push(value);
        } else if (trimmed && !trimmed.startsWith("#")) {
          // New top-level key — stop
          break;
        }
      }
    }

    if (patterns.length > 0) {
      return resolveWorkspaceGlobs(cwd, patterns);
    }
  }

  // 2. npm/yarn workspaces (package.json "workspaces" field)
  const rootPkg = await readFileOrNull(join(cwd, "package.json"));
  if (rootPkg) {
    try {
      const pkg = JSON.parse(rootPkg);
      const workspaces: string[] | undefined = Array.isArray(pkg.workspaces)
        ? pkg.workspaces
        : Array.isArray(pkg.workspaces?.packages)
          ? pkg.workspaces.packages
          : undefined;

      if (workspaces && workspaces.length > 0) {
        return resolveWorkspaceGlobs(cwd, workspaces);
      }
    } catch {
      // malformed JSON — ignore
    }
  }

  return [];
}

async function parseRequirementsTxt(cwd: string): Promise<string[]> {
  const content = await readFileOrNull(join(cwd, "requirements.txt"));
  if (!content) return [];

  const deps: string[] = [];
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("-")) continue;
    const name = trimmed.split(/[=<>!~;@\s\[]/)[0].trim();
    if (name && !isSkippedLocally(name)) {
      deps.push(name);
    }
  }
  return deps;
}

async function parsePyprojectToml(cwd: string): Promise<string[]> {
  const content = await readFileOrNull(join(cwd, "pyproject.toml"));
  if (!content) return [];

  const deps: string[] = [];
  const seen = new Set<string>();

  const projectDepsMatch = content.match(/\[project\]\s[\s\S]*?dependencies\s*=\s*\[([\s\S]*?)\]/);
  if (projectDepsMatch) {
    const entries = projectDepsMatch[1].match(/"([^"]+)"/g) || [];
    for (const entry of entries) {
      const name = entry
        .replace(/"/g, "")
        .split(/[=<>!~;@\s\[]/)[0]
        .trim();
      if (name && !isSkippedLocally(name) && !seen.has(name)) {
        seen.add(name);
        deps.push(name);
      }
    }
  }

  const poetryMatch = content.match(/\[tool\.poetry\.dependencies\]([\s\S]*?)(?:\n\[|$)/);
  if (poetryMatch) {
    const lines = poetryMatch[1].split("\n");
    for (const line of lines) {
      const match = line.match(/^(\S+)\s*=/);
      if (match) {
        const name = match[1].trim();
        if (name && !isSkippedLocally(name) && name !== "python" && !seen.has(name)) {
          seen.add(name);
          deps.push(name);
        }
      }
    }
  }

  return deps;
}

export async function detectProjectDependencies(cwd: string): Promise<string[]> {
  const results = await Promise.all([
    parsePackageJson(cwd),
    parseRequirementsTxt(cwd),
    parsePyprojectToml(cwd),
  ]);

  // Also scan workspace packages in monorepos (pnpm, npm, yarn workspaces)
  const workspaceDirs = await getWorkspaceDirs(cwd);
  const workspaceResults = await Promise.all(workspaceDirs.map((dir) => parsePackageJson(dir)));

  return [...new Set([...results.flat(), ...workspaceResults.flat()])];
}
