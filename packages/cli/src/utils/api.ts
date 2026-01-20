import type {
  RepoSkillsResponse,
  SkillResponse,
  SearchResponse,
  IndexResponse,
  DownloadResponse,
} from "../types.js";

const CONTEXT7_API = process.env.CONTEXT7_API_URL || "http://localhost:3001/api/v1";

export async function getRepoSkills(
  repoId: string,
  forceReindex = false
): Promise<RepoSkillsResponse> {
  const params = new URLSearchParams({ id: repoId });
  if (forceReindex) params.set("reindex", "true");

  const response = await fetch(`${CONTEXT7_API}/skills/repo?${params}`);
  return (await response.json()) as RepoSkillsResponse;
}

export async function getSkill(skillId: string): Promise<SkillResponse> {
  const params = new URLSearchParams({ id: skillId });
  const response = await fetch(`${CONTEXT7_API}/skills/skill?${params}`);
  return (await response.json()) as SkillResponse;
}

export async function searchSkills(query: string): Promise<SearchResponse> {
  const params = new URLSearchParams({ q: query });
  const response = await fetch(`${CONTEXT7_API}/skills/search?${params}`);
  return (await response.json()) as SearchResponse;
}

export async function indexSkillFromUrl(url: string): Promise<IndexResponse> {
  const response = await fetch(`${CONTEXT7_API}/skills/index`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  return (await response.json()) as IndexResponse;
}

export async function downloadSkill(skillId: string): Promise<DownloadResponse> {
  const params = new URLSearchParams({ id: skillId });
  const response = await fetch(`${CONTEXT7_API}/skills/download?${params}`);
  return (await response.json()) as DownloadResponse;
}
