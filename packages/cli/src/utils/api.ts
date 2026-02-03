import type {
  ListSkillsResponse,
  SingleSkillResponse,
  SearchResponse,
  SuggestResponse,
  DownloadResponse,
  LibrarySearchResponse,
  SkillQuestionsResponse,
  StructuredGenerateInput,
  GenerateStreamEvent,
  SkillQuotaResponse,
} from "../types.js";
import { downloadSkillFromGitHub } from "./github.js";

let baseUrl = "https://context7.com";

export function getBaseUrl(): string {
  return baseUrl;
}

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

export async function suggestSkills(
  dependencies: string[],
  accessToken?: string
): Promise<SuggestResponse> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (accessToken) {
    headers["Authorization"] = `Bearer ${accessToken}`;
  }
  const response = await fetch(`${baseUrl}/api/v2/skills/suggest`, {
    method: "POST",
    headers,
    body: JSON.stringify({ dependencies }),
  });
  return (await response.json()) as SuggestResponse;
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

export async function searchLibraries(
  query: string,
  accessToken?: string
): Promise<LibrarySearchResponse> {
  const params = new URLSearchParams({ query });
  const headers: Record<string, string> = {};
  if (accessToken) {
    headers["Authorization"] = `Bearer ${accessToken}`;
  }
  const response = await fetch(`${baseUrl}/api/v2/libs/search?${params}`, { headers });
  return (await response.json()) as LibrarySearchResponse;
}

export async function getSkillQuota(accessToken: string): Promise<SkillQuotaResponse> {
  const response = await fetch(`${baseUrl}/api/v2/skills/quota`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    return {
      used: 0,
      limit: 0,
      remaining: 0,
      tier: "free",
      resetDate: null,
      error: (errorData as { message?: string }).message || `HTTP error ${response.status}`,
    };
  }

  return (await response.json()) as SkillQuotaResponse;
}

export async function getSkillQuestions(
  libraries: Array<{ id: string; name: string }>,
  motivation: string,
  accessToken?: string
): Promise<SkillQuestionsResponse> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (accessToken) {
    headers["Authorization"] = `Bearer ${accessToken}`;
  }

  const response = await fetch(`${baseUrl}/api/v2/skills/questions`, {
    method: "POST",
    headers,
    body: JSON.stringify({ libraries, motivation }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    return {
      questions: [],
      error: (errorData as { message?: string }).message || `HTTP error ${response.status}`,
    };
  }

  return (await response.json()) as SkillQuestionsResponse;
}

export async function generateSkillStructured(
  input: StructuredGenerateInput,
  onEvent?: (event: GenerateStreamEvent) => void,
  accessToken?: string
): Promise<GenerateSkillResponse> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (accessToken) {
    headers["Authorization"] = `Bearer ${accessToken}`;
  }

  const response = await fetch(`${baseUrl}/api/v2/skills/generate`, {
    method: "POST",
    headers,
    body: JSON.stringify(input),
  });

  const libraryName = input.libraries[0]?.name || "skill";
  return handleGenerateResponse(response, libraryName, onEvent);
}

async function handleGenerateResponse(
  response: Response,
  libraryName: string,
  onEvent?: (event: GenerateStreamEvent) => void
): Promise<GenerateSkillResponse> {
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    return {
      content: "",
      libraryName,
      error: (errorData as { message?: string }).message || `HTTP error ${response.status}`,
    };
  }

  const reader = response.body?.getReader();
  if (!reader) {
    return { content: "", libraryName, error: "No response body" };
  }

  const decoder = new TextDecoder();
  let content = "";
  let finalLibraryName = libraryName;
  let error: string | undefined;
  let buffer = ""; // Buffer for incomplete lines across chunks

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value, { stream: true });
    buffer += chunk;

    // Split by newline but keep track of incomplete lines
    const lines = buffer.split("\n");
    // Keep the last element (may be incomplete) in the buffer
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmedLine = line.trim();
      if (!trimmedLine) continue;

      try {
        const data = JSON.parse(trimmedLine) as GenerateStreamEvent;

        if (onEvent) {
          onEvent(data);
        }

        if (data.type === "complete") {
          content = data.content || "";
          finalLibraryName = data.libraryName || libraryName;
        } else if (data.type === "error") {
          error = data.message;
        }
      } catch {
        // Ignore malformed JSON lines
      }
    }
  }

  // Process any remaining data in the buffer
  if (buffer.trim()) {
    try {
      const data = JSON.parse(buffer.trim()) as GenerateStreamEvent;
      if (onEvent) {
        onEvent(data);
      }
      if (data.type === "complete") {
        content = data.content || "";
        finalLibraryName = data.libraryName || libraryName;
      } else if (data.type === "error") {
        error = data.message;
      }
    } catch {
      // Ignore malformed JSON
    }
  }

  return { content, libraryName: finalLibraryName, error };
}
