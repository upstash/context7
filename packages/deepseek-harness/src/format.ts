import type { SearchResponse, SearchResult } from "./api.js";

function reputation(score?: number): "High" | "Medium" | "Low" | "Unknown" {
  if (score === undefined || score < 0) return "Unknown";
  if (score >= 7) return "High";
  if (score >= 4) return "Medium";
  return "Low";
}

function formatResult(result: SearchResult): string {
  const lines = [
    `- Title: ${result.title}`,
    `- Context7-compatible library ID: ${result.id}`,
    `- Description: ${result.description}`,
  ];
  if (result.totalSnippets !== undefined && result.totalSnippets !== -1) {
    lines.push(`- Code Snippets: ${result.totalSnippets}`);
  }
  lines.push(`- Source Reputation: ${reputation(result.trustScore)}`);
  if (result.benchmarkScore !== undefined && result.benchmarkScore > 0) {
    lines.push(`- Benchmark Score: ${result.benchmarkScore}`);
  }
  if (result.versions?.length) {
    lines.push(`- Versions: ${result.versions.join(", ")}`);
  }
  if (result.source) {
    lines.push(`- Source: ${result.source}`);
  }
  return lines.join("\n");
}

export function formatSearchResults(response: SearchResponse): string {
  if (response.results.length === 0) return "No libraries found matching the provided name.";
  const parts = [];
  if (response.searchFilterApplied) {
    parts.push(
      "**Note:** Your results only include libraries matching your teamspace's library filters. To adjust quality thresholds or blocked libraries, update your filters at https://context7.com/dashboard?tab=policies"
    );
  }
  parts.push(response.results.map(formatResult).join("\n----------\n"));
  return `Available Libraries:\n\n${parts.join("\n\n")}`;
}
