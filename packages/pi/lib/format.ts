// Copied verbatim from @upstash/context7-mcp (packages/mcp/src/lib/utils.ts)
// to keep pi's text output identical to what MCP produces. Update both together.

import type { SearchResponse, SearchResult } from "./types";

function getSourceReputationLabel(
  sourceReputation?: number
): "High" | "Medium" | "Low" | "Unknown" {
  if (sourceReputation === undefined || sourceReputation < 0) return "Unknown";
  if (sourceReputation >= 7) return "High";
  if (sourceReputation >= 4) return "Medium";
  return "Low";
}

export function formatSearchResult(result: SearchResult): string {
  const formattedResult = [
    `- Title: ${result.title}`,
    `- Context7-compatible library ID: ${result.id}`,
    `- Description: ${result.description}`,
  ];

  if (result.totalSnippets !== -1 && result.totalSnippets !== undefined) {
    formattedResult.push(`- Code Snippets: ${result.totalSnippets}`);
  }

  const reputationLabel = getSourceReputationLabel(result.trustScore);
  formattedResult.push(`- Source Reputation: ${reputationLabel}`);

  if (result.benchmarkScore !== undefined && result.benchmarkScore > 0) {
    formattedResult.push(`- Benchmark Score: ${result.benchmarkScore}`);
  }

  if (result.versions !== undefined && result.versions.length > 0) {
    formattedResult.push(`- Versions: ${result.versions.join(", ")}`);
  }

  if (result.source) {
    formattedResult.push(`- Source: ${result.source}`);
  }

  return formattedResult.join("\n");
}

export function formatSearchResults(searchResponse: SearchResponse): string {
  if (!searchResponse.results || searchResponse.results.length === 0) {
    return "No documentation libraries found matching your query.";
  }

  const parts: string[] = [];

  if (searchResponse.searchFilterApplied) {
    parts.push(
      "**Note:** Your results only include libraries matching your teamspace's library filters. To adjust quality thresholds or blocked libraries, update your filters at https://context7.com/dashboard?tab=policies"
    );
  }

  const formattedResults = searchResponse.results.map(formatSearchResult);
  parts.push(formattedResults.join("\n----------\n"));

  return parts.join("\n\n");
}
