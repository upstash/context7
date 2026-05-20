import { readdir, readFile } from "fs/promises";
import { join, relative, resolve, sep } from "path";

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

function stripInlineComment(value: string): string {
  let quote: string | null = null;
  for (let i = 0; i < value.length; i++) {
    const char = value[i];
    if ((char === '"' || char === "'") && value[i - 1] !== "\\") {
      quote = quote === char ? null : (quote ?? char);
    }
    if (char === "#" && !quote) {
      return value.slice(0, i).trim();
    }
  }
  return value.trim();
}

function parseYamlStringList(value: string): string[] {
  const trimmed = stripInlineComment(value).trim();
  if (!trimmed) return [];

  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed
      .slice(1, -1)
      .split(",")
      .map((item) => item.trim().replace(/^["']|["']$/g, ""))
      .filter(Boolean);
  }

  return [trimmed.replace(/^["']|["']$/g, "")].filter(Boolean);
}

function parsePnpmWorkspacePatterns(content: string): string[] {
  const patterns: string[] = [];
  const lines = content.split("\n");
  let packagesIndent: number | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const indent = line.length - line.trimStart().length;
    if (packagesIndent === null) {
      const match = trimmed.match(/^packages\s*:\s*(.*)$/);
      if (!match) continue;

      packagesIndent = indent;
      patterns.push(...parseYamlStringList(match[1]));
      continue;
    }

    if (indent <= packagesIndent && !trimmed.startsWith("-")) {
      break;
    }

    if (trimmed.startsWith("- ")) {
      patterns.push(...parseYamlStringList(trimmed.slice(2)));
    }
  }

  return patterns;
}

async function getWorkspacePatternsFromPnpm(cwd: string): Promise<string[]> {
  const content = await readFileOrNull(join(cwd, "pnpm-workspace.yaml"));
  if (!content) return [];
  return parsePnpmWorkspacePatterns(content);
}

async function getWorkspacePatternsFromPackageJson(cwd: string): Promise<string[]> {
  const content = await readFileOrNull(join(cwd, "package.json"));
  if (!content) return [];

  try {
    const pkg = JSON.parse(content) as {
      workspaces?: string[] | { packages?: string[] };
    };
    if (Array.isArray(pkg.workspaces)) return pkg.workspaces;
    if (Array.isArray(pkg.workspaces?.packages)) return pkg.workspaces.packages;
  } catch {
    return [];
  }

  return [];
}

function normalizeWorkspacePattern(pattern: string): string {
  return pattern
    .replace(/\\/g, "/")
    .replace(/^\.?\//, "")
    .replace(/\/package\.json$/, "")
    .replace(/\/+$/, "");
}

function getPatternBaseDir(cwd: string, pattern: string): string {
  const normalized = normalizeWorkspacePattern(pattern);
  const parts = normalized.split("/");
  const globIndex = parts.findIndex((part) => part.includes("*"));
  const baseParts = globIndex === -1 ? parts : parts.slice(0, globIndex);
  return resolve(cwd, baseParts.length === 0 ? "." : baseParts.join("/"));
}

function escapeRegex(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

function workspacePatternToRegex(pattern: string): RegExp {
  const normalized = normalizeWorkspacePattern(pattern);
  const segments = normalized.split("/").filter(Boolean);
  let source = "^";

  if (segments.length === 0) {
    source += "$";
    return new RegExp(source);
  }

  segments.forEach((segment, index) => {
    if (index > 0) source += "/";

    if (segment === "**") {
      source += "(?:[^/]+/)*[^/]*";
      return;
    }

    let segmentSource = "";
    for (const char of segment) {
      segmentSource += char === "*" ? "[^/]*" : escapeRegex(char);
    }
    source += segmentSource;
  });

  source += "$";
  return new RegExp(source);
}

async function findPackageJsonDirs(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const dirs: string[] = [];
  if (entries.some((entry) => entry.isFile() && entry.name === "package.json")) {
    dirs.push(dir);
  }

  const ignoredDirs = new Set([
    ".git",
    ".hg",
    ".svn",
    "node_modules",
    "dist",
    "build",
    "coverage",
    ".next",
    ".nuxt",
    ".turbo",
    ".vercel",
  ]);

  const childDirs = entries.filter((entry) => entry.isDirectory() && !ignoredDirs.has(entry.name));
  const childResults = await Promise.all(
    childDirs.map((entry) => findPackageJsonDirs(join(dir, entry.name)))
  );

  return [...dirs, ...childResults.flat()];
}

async function getWorkspaceDirs(cwd: string): Promise<string[]> {
  const rawPatterns = [
    ...(await getWorkspacePatternsFromPnpm(cwd)),
    ...(await getWorkspacePatternsFromPackageJson(cwd)),
  ];

  const includePatterns = rawPatterns
    .filter((pattern) => !pattern.trim().startsWith("!"))
    .map(normalizeWorkspacePattern)
    .filter(Boolean);
  const excludePatterns = rawPatterns
    .filter((pattern) => pattern.trim().startsWith("!"))
    .map((pattern) => normalizeWorkspacePattern(pattern.trim().slice(1)))
    .filter(Boolean);

  if (includePatterns.length === 0) return [];

  const includeRegexes = includePatterns.map(workspacePatternToRegex);
  const excludeRegexes = excludePatterns.map(workspacePatternToRegex);
  const searchRoots = [
    ...new Set(includePatterns.map((pattern) => getPatternBaseDir(cwd, pattern))),
  ];

  const candidates = (await Promise.all(searchRoots.map(findPackageJsonDirs))).flat();
  const workspaceDirs = new Set<string>();

  for (const candidate of candidates) {
    const rel = relative(cwd, candidate).split(sep).join("/");
    if (!rel || rel.startsWith("..")) continue;
    if (!includeRegexes.some((regex) => regex.test(rel))) continue;
    if (excludeRegexes.some((regex) => regex.test(rel))) continue;
    workspaceDirs.add(candidate);
  }

  return [...workspaceDirs];
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

  const workspaceDirs = await getWorkspaceDirs(cwd);
  const workspaceResults = await Promise.all(workspaceDirs.map((dir) => parsePackageJson(dir)));

  return [...new Set([...results.flat(), ...workspaceResults.flat()])];
}
