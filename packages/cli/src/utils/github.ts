import { execSync } from "node:child_process";
import type { SkillFile, Skill } from "../types.js";

const GITHUB_API = "https://api.github.com";
const GITHUB_RAW = "https://raw.githubusercontent.com";

interface GitHubTreeItem {
  path: string;
  mode: string;
  type: "blob" | "tree";
  sha: string;
  size?: number;
  url: string;
}

interface GitHubTreeResponse {
  sha: string;
  url: string;
  tree: GitHubTreeItem[];
  truncated: boolean;
}

function parseGitHubUrl(url: string): {
  owner: string;
  repo: string;
  branch: string;
  path: string;
} | null {
  try {
    const urlObj = new URL(url);
    const parts = urlObj.pathname.split("/").filter(Boolean);

    // Handle raw.githubusercontent.com URLs
    // Format: https://raw.githubusercontent.com/owner/repo/refs/heads/branch/path/SKILL.md
    if (urlObj.hostname === "raw.githubusercontent.com") {
      if (parts.length < 5) return null;

      const owner = parts[0];
      const repo = parts[1];

      // Handle refs/heads/branch format
      if (parts[2] === "refs" && parts[3] === "heads") {
        const branch = parts[4];
        // Get directory path (exclude the filename like SKILL.md)
        const pathParts = parts.slice(5);
        // Remove the last part if it looks like a file (has extension)
        if (pathParts.length > 0 && pathParts[pathParts.length - 1].includes(".")) {
          pathParts.pop();
        }
        const path = pathParts.join("/");
        return { owner, repo, branch, path };
      }

      // Handle direct branch format: owner/repo/branch/path
      const branch = parts[2];
      const pathParts = parts.slice(3);
      if (pathParts.length > 0 && pathParts[pathParts.length - 1].includes(".")) {
        pathParts.pop();
      }
      const path = pathParts.join("/");
      return { owner, repo, branch, path };
    }

    // Handle github.com tree URLs
    // Format: https://github.com/owner/repo/tree/branch/path
    if (urlObj.hostname === "github.com") {
      if (parts.length < 4 || parts[2] !== "tree") return null;

      const owner = parts[0];
      const repo = parts[1];
      const branch = parts[3];
      const path = parts.slice(4).join("/");

      return { owner, repo, branch, path };
    }

    return null;
  } catch {
    return null;
  }
}

function getGitHubToken(): string | undefined {
  const envToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (envToken) return envToken;
  try {
    return execSync("gh auth token", { stdio: ["pipe", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return undefined;
  }
}

function parseSkillFrontmatter(content: string): { name: string; description: string } | null {
  const frontmatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!frontmatterMatch) return null;

  const frontmatter = frontmatterMatch[1];

  const nameMatch = frontmatter.match(/^name:\s*(.+)$/m);
  if (!nameMatch) return null;
  const name = nameMatch[1]
    .trim()
    .replace(/^["']|["']$/g, "")
    .toLowerCase();

  let description = "";
  const multiLineMatch = frontmatter.match(/^description:\s*([|>])-?\s*$/m);

  if (multiLineMatch) {
    const descLineIndex = frontmatter.indexOf("description:");
    const lines = frontmatter.slice(descLineIndex).split("\n").slice(1);
    const indentedLines: string[] = [];
    for (const line of lines) {
      if (line.trim() === "") {
        indentedLines.push("");
        continue;
      }
      if (/^\s+/.test(line)) {
        indentedLines.push(line);
      } else {
        break;
      }
    }
    const firstNonEmpty = indentedLines.find((l) => l.trim().length > 0);
    const indent = firstNonEmpty?.match(/^(\s+)/)?.[1].length ?? 0;
    description = indentedLines
      .map((line) => line.slice(indent))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
  } else {
    const singleMatch = frontmatter.match(/^description:\s*(.+)$/m);
    if (singleMatch) {
      const value = singleMatch[1].trim();
      if (!["|", ">", "|-", ">-"].includes(value)) {
        description = value.replace(/^["']|["']$/g, "");
      }
    }
  }

  if (!description) return null;
  return { name, description };
}

function getGitHubHeaders(): Record<string, string> {
  const ghToken = getGitHubToken();
  return {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "context7-cli",
    ...(ghToken && { Authorization: `token ${ghToken}` }),
  };
}

async function fetchRepoTree(
  owner: string,
  repo: string,
  branch: string,
  headers: Record<string, string>
): Promise<GitHubTreeResponse | null> {
  const treeUrl = `${GITHUB_API}/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`;
  const response = await fetch(treeUrl, { headers });
  if (!response.ok) return null;
  return (await response.json()) as GitHubTreeResponse;
}

async function fetchDefaultBranch(
  owner: string,
  repo: string,
  headers: Record<string, string>
): Promise<{ branch: string } | { status: number }> {
  const response = await fetch(`${GITHUB_API}/repos/${owner}/${repo}`, { headers });
  if (!response.ok) return { status: response.status };
  const data = (await response.json()) as { default_branch: string };
  return { branch: data.default_branch };
}

type GitHubSkillsResult =
  | { status: "ok"; skills: (Skill & { project: string })[] }
  | { status: "repo_not_found" }
  | { status: "error"; error: string };

export async function listSkillsFromGitHub(project: string): Promise<GitHubSkillsResult> {
  try {
    const parts = project.split("/").filter(Boolean);
    if (parts.length < 2) return { status: "error", error: "Invalid project format" };
    const [owner, repo] = parts;

    const headers = getGitHubHeaders();
    const branchResult = await fetchDefaultBranch(owner, repo, headers);
    if ("status" in branchResult) return { status: "repo_not_found" };

    const treeData = await fetchRepoTree(owner, repo, branchResult.branch, headers);
    if (!treeData) return { status: "error", error: "Could not fetch repository tree" };

    const skillMdFiles = treeData.tree.filter(
      (item) => item.type === "blob" && item.path.toLowerCase().endsWith("skill.md")
    );

    const skills: (Skill & { project: string })[] = [];
    for (const item of skillMdFiles) {
      const rawUrl = `${GITHUB_RAW}/${owner}/${repo}/${branchResult.branch}/${item.path}`;
      const response = await fetch(rawUrl, { headers });
      if (!response.ok) continue;

      const content = await response.text();
      const meta = parseSkillFrontmatter(content);
      if (!meta) continue;

      const skillDir = item.path.split("/").slice(0, -1).join("/");
      skills.push({
        name: meta.name,
        description: meta.description,
        url: `https://github.com/${owner}/${repo}/tree/${branchResult.branch}/${skillDir}`,
        project,
      });
    }

    return { status: "ok", skills };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { status: "error", error: message };
  }
}

export async function getSkillFromGitHub(
  project: string,
  skillName: string
): Promise<GitHubSkillsResult & { skill?: Skill & { project: string } }> {
  const result = await listSkillsFromGitHub(project);
  if (result.status !== "ok") return result;
  const skill = result.skills.find((s) => s.name === skillName.toLowerCase());
  return { ...result, skill };
}

export async function downloadSkillFromGitHub(
  skill: Skill & { project: string }
): Promise<{ files: SkillFile[]; error?: string }> {
  try {
    const parsed = parseGitHubUrl(skill.url);

    if (!parsed) {
      return { files: [], error: `Invalid GitHub URL: ${skill.url}` };
    }

    const { owner, repo, branch, path: skillPath } = parsed;

    const ghHeaders = getGitHubHeaders();

    const treeData = await fetchRepoTree(owner, repo, branch, ghHeaders);
    if (!treeData) {
      return { files: [], error: `GitHub API error` };
    }

    const skillFiles = treeData.tree.filter(
      (item) => item.type === "blob" && item.path.startsWith(skillPath + "/")
    );

    if (skillFiles.length === 0) {
      return { files: [], error: `No files found in ${skillPath}` };
    }

    const files: SkillFile[] = [];
    for (const item of skillFiles) {
      const rawUrl = `${GITHUB_RAW}/${owner}/${repo}/${branch}/${item.path}`;
      const fileResponse = await fetch(rawUrl, { headers: ghHeaders });

      if (!fileResponse.ok) {
        console.warn(`Failed to fetch ${item.path}: ${fileResponse.status}`);
        continue;
      }

      const content = await fileResponse.text();
      const relativePath = item.path.slice(skillPath.length + 1);

      // Reject paths that attempt directory traversal
      if (relativePath.includes("..")) {
        console.warn(`Skipping file with unsafe path: ${item.path}`);
        continue;
      }

      files.push({
        path: relativePath,
        content,
      });
    }

    return { files };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { files: [], error: message };
  }
}
