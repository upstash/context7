export interface ParsedSkillInput {
  type: "repo" | "skill" | "url";
  owner: string;
  repo: string;
  skillName?: string;
  branch?: string;
  path?: string;
}

export function parseSkillInput(input: string): ParsedSkillInput {
  const urlMatch = input.match(
    /(?:https?:\/\/)?github\.com\/([^\/]+)\/([^\/]+)\/tree\/([^\/]+)\/(.+)/
  );
  if (urlMatch) {
    const [, owner, repo, branch, path] = urlMatch;
    const skillName = path.split("/").pop();
    return { type: "url", owner, repo, branch, path, skillName };
  }

  const shortMatch = input.match(/^\/?([^\/]+)\/([^\/]+)(?:\/(.+))?$/);
  if (shortMatch) {
    const [, owner, repo, skillName] = shortMatch;
    return { type: skillName ? "skill" : "repo", owner, repo, skillName };
  }

  throw new Error(
    `Invalid input format: ${input}\n` +
      `Expected: /owner/repo, /owner/repo/skill, or full GitHub URL`
  );
}

export function buildSkillId(owner: string, repo: string, skillName: string): string {
  return `/${owner}/${repo}/${skillName}`;
}

export function buildRepoId(owner: string, repo: string): string {
  return `/${owner}/${repo}`;
}
