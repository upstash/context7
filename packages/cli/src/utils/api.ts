import type {
  ListSkillsResponse,
  SingleSkillResponse,
  SearchResponse,
  DownloadResponse,
} from "../types.js";
import { downloadSkillFromGitHub } from "./github.js";

let baseUrl = "https://context7.com";

export function setBaseUrl(url: string): void {
  baseUrl = url;
}

export async function listProjectSkills(project: string): Promise<ListSkillsResponse> {
  const params = new URLSearchParams({ project });
  const response = await fetch(`${baseUrl}/api/v2/skills?${params}`);
  return (await response.json()) as ListSkillsResponse;
}

export async function getSkill(project: string, skillName: string): Promise<SingleSkillResponse> {
  const params = new URLSearchParams({ project, skill: skillName });
  const response = await fetch(`${baseUrl}/api/v2/skills?${params}`);
  return (await response.json()) as SingleSkillResponse;
}

export async function searchSkills(query: string): Promise<SearchResponse> {
  const params = new URLSearchParams({ query });
  const response = await fetch(`${baseUrl}/api/v2/skills?${params}`);
  return (await response.json()) as SearchResponse;
}

export function trackInstalls(skills: string[], ides: string[]): void {
  if (process.env.CTX7_TELEMETRY_DISABLED || !skills.length) return;
  fetch(`${baseUrl}/api/v2/skills/track`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ skills, ides }),
  }).catch(() => {});
}

export async function downloadSkill(project: string, skillName: string): Promise<DownloadResponse> {
  const skillData = await getSkill(project, skillName);

  if (skillData.error) {
    return {
      skill: { name: skillName, description: "", url: "", project },
      files: [],
      error: skillData.message || skillData.error,
    };
  }

  const skill = {
    name: skillData.name,
    description: skillData.description,
    url: skillData.url,
    project: skillData.project,
  };

  const { files, error } = await downloadSkillFromGitHub(skill);

  if (error) {
    return { skill, files: [], error };
  }

  return { skill, files };
}

export interface GenerateSkillResponse {
  content: string;
  libraryName: string;
  error?: string;
}

export async function generateSkill(
  library: string,
  topic?: string,
  onProgress?: (message: string) => void
): Promise<GenerateSkillResponse> {
  const response = await fetch(`${baseUrl}/api/v2/skills/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ library, topic }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    return {
      content: "",
      libraryName: library,
      error: (errorData as { message?: string }).message || `HTTP error ${response.status}`,
    };
  }

  const reader = response.body?.getReader();
  if (!reader) {
    return { content: "", libraryName: library, error: "No response body" };
  }

  const decoder = new TextDecoder();
  let content = "";
  let libraryName = library;
  let error: string | undefined;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value, { stream: true });
    const lines = chunk.split("\n").filter((line) => line.trim());

    for (const line of lines) {
      try {
        const data = JSON.parse(line) as {
          type: string;
          message?: string;
          content?: string;
          libraryName?: string;
        };

        if (data.type === "progress" && onProgress && data.message) {
          onProgress(data.message);
        } else if (data.type === "complete") {
          content = data.content || "";
          libraryName = data.libraryName || library;
        } else if (data.type === "error") {
          error = data.message;
        }
      } catch {
        // Ignore malformed JSON lines
      }
    }
  }

  return { content, libraryName, error };
}
