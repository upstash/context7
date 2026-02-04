import { readFile, readdir } from "fs/promises";
import { join } from "path";

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
    for (const key of Object.keys(pkg.optionalDependencies || {})) {
      if (!isSkippedLocally(key)) names.add(key);
    }
    for (const key of Object.keys(pkg.peerDependencies || {})) {
      if (!isSkippedLocally(key)) names.add(key);
    }

    return [...names];
  } catch {
    return [];
  }
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

  return [...new Set(results.flat())];
}

/**
 * Parses package-lock.json to get direct dependencies.
 * The lockfile is updated BEFORE postinstall, so we can use it to detect new packages.
 */
async function parseLockfileDeps(cwd: string): Promise<string[] | null> {
  // Try package-lock.json (npm)
  const npmLockContent = await readFileOrNull(join(cwd, "package-lock.json"));
  if (npmLockContent) {
    try {
      const lock = JSON.parse(npmLockContent);
      // lockfileVersion 2/3 has packages[""] with dependencies
      const rootPkg = lock.packages?.[""];
      if (rootPkg) {
        const deps = [
          ...Object.keys(rootPkg.dependencies || {}),
          ...Object.keys(rootPkg.devDependencies || {}),
          ...Object.keys(rootPkg.optionalDependencies || {}),
        ];
        return deps.filter((d) => !isSkippedLocally(d));
      }
    } catch {
      // Failed to parse lockfile
    }
  }

  return null;
}

/**
 * Detects newly installed packages by comparing lockfile/node_modules with package.json.
 * This is useful for postinstall hooks where package.json hasn't been updated yet
 * but the lockfile and node_modules already contain the new packages.
 *
 * Supports:
 * - pnpm: compares node_modules (only direct deps symlinked) vs package.json
 * - npm: compares package-lock.json vs package.json
 */
export async function detectNewlyInstalledPackages(cwd: string): Promise<string[]> {
  // Get declared dependencies from package.json (not yet updated during postinstall)
  const declaredDeps = await parsePackageJson(cwd);
  const declaredSet = new Set(declaredDeps);

  // Get packages in node_modules
  const nodeModulesPath = join(cwd, "node_modules");

  try {
    const entries = await readdir(nodeModulesPath);
    const isPnpm = entries.includes(".pnpm");

    if (isPnpm) {
      // pnpm: only direct deps are symlinked to top-level node_modules
      let installedPackages: string[] = [];

      // Regular packages (non-scoped)
      const regularPackages = entries.filter((e) => !e.startsWith(".") && !e.startsWith("@"));

      // Scoped packages (@org/pkg)
      const scopedDirs = entries.filter((e) => e.startsWith("@"));
      const scopedPackages: string[] = [];

      for (const scope of scopedDirs) {
        try {
          const scopePath = join(nodeModulesPath, scope);
          const packages = await readdir(scopePath);
          for (const pkg of packages) {
            if (!pkg.startsWith(".")) {
              scopedPackages.push(`${scope}/${pkg}`);
            }
          }
        } catch {
          // Scope directory not readable, skip
        }
      }

      installedPackages = [...regularPackages, ...scopedPackages];

      // Find packages in node_modules but NOT in package.json
      return installedPackages.filter((pkg) => !declaredSet.has(pkg) && !isSkippedLocally(pkg));
    } else {
      // npm/yarn: use lockfile instead (node_modules has hoisted transitive deps)
      const lockfileDeps = await parseLockfileDeps(cwd);
      if (lockfileDeps) {
        // Find packages in lockfile but NOT in package.json
        return lockfileDeps.filter((pkg) => !declaredSet.has(pkg));
      }
      return [];
    }
  } catch {
    // node_modules doesn't exist or not readable
    return [];
  }
}
