export interface ParsedSkillInput {
  type: "repo" | "url";
  owner: string;
  repo: string;
  branch?: string;
  path?: string;
}

export function parseSkillInput(input: string): ParsedSkillInput | null {
  const urlMatch = input.match(
    /(?:https?:\/\/)?github\.com\/([^\/]+)\/([^\/]+)\/tree\/([^\/]+)\/(.+)/
  );
  if (urlMatch) {
    const [, owner, repo, branch, path] = urlMatch;
    return { type: "url", owner, repo, branch, path };
  }

  const shortMatch = input.match(/^\/?([^\/]+)\/([^\/]+)$/);
  if (shortMatch) {
    const [, owner, repo] = shortMatch;
    return { type: "repo", owner, repo };
  }

  return null;
}
