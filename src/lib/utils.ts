import { SearchResponse, SearchResult } from "./types.js";

/**
 * Formats a search result into a human-readable string representation.
 * Only shows code snippet count and GitHub stars when available (not equal to -1).
 *
 * @param result The SearchResult object to format
 * @returns A formatted string with library information
 */
export function formatSearchResult(result: SearchResult): string {
  // Always include these basic details
  const formattedResult = [
    `- Title: ${result.title}`,
    `- Context7-compatible library ID: ${result.id}`,
    `- Description: ${result.description}`,
  ];

  // Only add code snippets count if it's a valid value
  if (result.totalSnippets !== -1 && result.totalSnippets !== undefined) {
    formattedResult.push(`- Code Snippets: ${result.totalSnippets}`);
  }

  // Only add trust score if it's a valid value
  if (result.trustScore !== -1 && result.trustScore !== undefined) {
    formattedResult.push(`- Trust Score: ${result.trustScore}`);
  }

  // Only add benchmark score if it's a valid value
  if (result.benchmarkScore !== undefined && result.benchmarkScore > 0) {
    formattedResult.push(`- Benchmark Score: ${result.benchmarkScore}`);
  }

  // Only add versions if it's a valid value
  if (result.versions !== undefined && result.versions.length > 0) {
    formattedResult.push(`- Versions: ${result.versions.join(", ")}`);
  }

  // Join all parts with newlines
  return formattedResult.join("\n");
}

/**
 * Formats a search response into a human-readable string representation.
 * Each result is formatted using formatSearchResult.
 *
 * @param searchResponse The SearchResponse object to format
 * @returns A formatted string with search results
 */
export function formatSearchResults(searchResponse: SearchResponse): string {
  if (!searchResponse.results || searchResponse.results.length === 0) {
    return "No documentation libraries found matching your query.";
  }

  const formattedResults = searchResponse.results.map(formatSearchResult);
  return formattedResults.join("\n----------\n");
}
