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

/**
 * Maps numeric trust score to an interpretable label.
 */
function getTrustScoreLabel(trustScore?: number): "High" | "Medium" | "Low" | "Unknown" {
  if (trustScore === undefined || trustScore < 0) return "Unknown";
  if (trustScore >= 7) return "High";
  if (trustScore >= 4) return "Medium";
  return "Low";
}

/**
 * Formats a single library as a human-readable text block.
 */
export function formatLibraryAsText(library: Library): string {
  const lines = [
    `- Title: ${library.name}`,
    `- Context7-compatible library ID: ${library.id}`,
    `- Description: ${library.description}`,
  ];

  if (library.totalSnippets > 0) {
    lines.push(`- Code Snippets: ${library.totalSnippets}`);
  }

  lines.push(`- Trust Score: ${getTrustScoreLabel(library.trustScore)}`);

  if (library.benchmarkScore > 0) {
    lines.push(`- Benchmark Score: ${library.benchmarkScore}`);
  }

  if (library.versions && library.versions.length > 0) {
    lines.push(`- Versions: ${library.versions.join(", ")}`);
  }

  return lines.join("\n");
}

/**
 * Formats an array of libraries as human-readable text.
 */
export function formatLibrariesAsText(libraries: Library[]): string {
  if (libraries.length === 0) {
    return "No documentation libraries found matching your query.";
  }

  return libraries.map(formatLibraryAsText).join("\n----------\n");
}
