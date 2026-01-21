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

export async function downloadSkillFromGitHub(
  skill: Skill & { project: string }
): Promise<{ files: SkillFile[]; error?: string }> {
  try {
    const parsed = parseGitHubUrl(skill.url);

    if (!parsed) {
      return { files: [], error: `Invalid GitHub URL: ${skill.url}` };
    }

    const { owner, repo, branch, path: skillPath } = parsed;

    const treeUrl = `${GITHUB_API}/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`;
    const treeResponse = await fetch(treeUrl, {
      headers: {
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "context7-cli",
      },
    });

    if (!treeResponse.ok) {
      return { files: [], error: `GitHub API error: ${treeResponse.status}` };
    }

    const treeData = (await treeResponse.json()) as GitHubTreeResponse;

    const skillFiles = treeData.tree.filter(
      (item) => item.type === "blob" && item.path.startsWith(skillPath + "/")
    );

    if (skillFiles.length === 0) {
      return { files: [], error: `No files found in ${skillPath}` };
    }

    const files: SkillFile[] = [];
    for (const item of skillFiles) {
      const rawUrl = `${GITHUB_RAW}/${owner}/${repo}/${branch}/${item.path}`;
      const fileResponse = await fetch(rawUrl);

      if (!fileResponse.ok) {
        console.warn(`Failed to fetch ${item.path}: ${fileResponse.status}`);
        continue;
      }

      const content = await fileResponse.text();
      const relativePath = item.path.slice(skillPath.length + 1);

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
