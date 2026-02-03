import { readFile } from "fs/promises";
import { join } from "path";

export interface DetectedDependency {
  name: string;
  source: string;
  ecosystem: string;
}

async function readFileOrNull(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf-8");
  } catch {
    return null;
  }
}

/**
 * Basic client-side filter to reduce payload size.
 * The real SKIP_SET lives on the backend.
 */
function isSkippedLocally(name: string): boolean {
  if (name.startsWith("@types/")) return true;
  return false;
}

async function parsePackageJson(cwd: string): Promise<DetectedDependency[]> {
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

    return [...names].map((name) => ({
      name,
      source: "package.json",
      ecosystem: "node",
    }));
  } catch {
    return [];
  }
}

async function parseRequirementsTxt(cwd: string): Promise<DetectedDependency[]> {
  const content = await readFileOrNull(join(cwd, "requirements.txt"));
  if (!content) return [];

  const deps: DetectedDependency[] = [];
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("-")) continue;
    const name = trimmed.split(/[=<>!~;@\s\[]/)[0].trim();
    if (name && !isSkippedLocally(name)) {
      deps.push({ name, source: "requirements.txt", ecosystem: "python" });
    }
  }
  return deps;
}

async function parsePyprojectToml(cwd: string): Promise<DetectedDependency[]> {
  const content = await readFileOrNull(join(cwd, "pyproject.toml"));
  if (!content) return [];

  const deps: DetectedDependency[] = [];
  const seen = new Set<string>();

  // Match dependencies in [project.dependencies] array
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
        deps.push({ name, source: "pyproject.toml", ecosystem: "python" });
      }
    }
  }

  // Match [tool.poetry.dependencies] section
  const poetryMatch = content.match(/\[tool\.poetry\.dependencies\]([\s\S]*?)(?:\n\[|$)/);
  if (poetryMatch) {
    const lines = poetryMatch[1].split("\n");
    for (const line of lines) {
      const match = line.match(/^(\S+)\s*=/);
      if (match) {
        const name = match[1].trim();
        if (name && !isSkippedLocally(name) && name !== "python" && !seen.has(name)) {
          seen.add(name);
          deps.push({ name, source: "pyproject.toml", ecosystem: "python" });
        }
      }
    }
  }

  return deps;
}

export async function detectProjectDependencies(cwd: string): Promise<DetectedDependency[]> {
  const results = await Promise.all([
    parsePackageJson(cwd),
    parseRequirementsTxt(cwd),
    parsePyprojectToml(cwd),
  ]);

  return results.flat();
}
