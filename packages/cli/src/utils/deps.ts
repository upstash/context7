import { readFile, readdir } from "fs/promises";
import { join } from "path";

async function readFileOrNull(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf-8");
  } catch {
    return null;
  }
}

function isSkippedLocally(name: string): boolean {
  return name.startsWith("@types/");
}

async function parsePackageJson(cwd: string): Promise<string[]> {
  const content = await readFileOrNull(join(cwd, "package.json"));
  if (!content) return [];

  try {
    const pkg = JSON.parse(content);
    const names = new Set<string>();
    const depTypes = [
      "dependencies",
      "devDependencies",
      "optionalDependencies",
      "peerDependencies",
    ];

    for (const type of depTypes) {
      for (const key of Object.keys(pkg[type] || {})) {
        if (!isSkippedLocally(key)) names.add(key);
      }
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
    if (name && !isSkippedLocally(name)) deps.push(name);
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
    for (const line of poetryMatch[1].split("\n")) {
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

async function parseLockfileDeps(cwd: string): Promise<string[] | null> {
  const content = await readFileOrNull(join(cwd, "package-lock.json"));
  if (!content) return null;

  try {
    const lock = JSON.parse(content);
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
    // Failed to parse
  }
  return null;
}

export async function detectNewlyInstalledPackages(cwd: string): Promise<string[]> {
  const declaredDeps = await parsePackageJson(cwd);
  const declaredSet = new Set(declaredDeps);
  const nodeModulesPath = join(cwd, "node_modules");

  try {
    const entries = await readdir(nodeModulesPath);
    const isPnpm = entries.includes(".pnpm");

    if (isPnpm) {
      const regularPackages = entries.filter((e) => !e.startsWith(".") && !e.startsWith("@"));
      const scopedPackages: string[] = [];

      for (const scope of entries.filter((e) => e.startsWith("@"))) {
        try {
          const packages = await readdir(join(nodeModulesPath, scope));
          for (const pkg of packages) {
            if (!pkg.startsWith(".")) scopedPackages.push(`${scope}/${pkg}`);
          }
        } catch {
          // Skip unreadable scope dirs
        }
      }

      const installed = [...regularPackages, ...scopedPackages];
      return installed.filter((pkg) => !declaredSet.has(pkg) && !isSkippedLocally(pkg));
    } else {
      const lockfileDeps = await parseLockfileDeps(cwd);
      return lockfileDeps ? lockfileDeps.filter((pkg) => !declaredSet.has(pkg)) : [];
    }
  } catch {
    return [];
  }
}
