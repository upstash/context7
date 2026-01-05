import type { Documentation, Library } from "@commands/types";
import type { ApiCodeSnippet, ApiInfoSnippet } from "@commands/get-context/types";

export function formatCodeSnippet(snippet: ApiCodeSnippet): Documentation {
  const codeBlocks = snippet.codeList
    .map((c) => `\`\`\`${c.language}\n${c.code}\n\`\`\``)
    .join("\n\n");

  const content = snippet.codeDescription
    ? `${snippet.codeDescription}\n\n${codeBlocks}`
    : codeBlocks;

  return {
    title: snippet.codeTitle,
    content,
    source: snippet.codeId,
  };
}

export function formatInfoSnippet(snippet: ApiInfoSnippet): Documentation {
  return {
    title: snippet.breadcrumb || "Documentation",
    content: snippet.content,
    source: snippet.pageId,
  };
}

export function formatLibrary(r: {
  id: string;
  title: string;
  description: string;
  versions?: string[];
  totalSnippets?: number;
  trustScore?: number;
  benchmarkScore?: number;
}): Library {
  return {
    id: r.id,
    name: r.title,
    description: r.description,
    totalSnippets: r.totalSnippets ?? 0,
    trustScore: r.trustScore ?? 0,
    benchmarkScore: r.benchmarkScore ?? 0,
    versions: r.versions,
  };
}
