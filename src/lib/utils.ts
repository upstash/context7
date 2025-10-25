import { SearchResponse, SearchResult } from "./types.js";

/**
 * Categorizes a trust score into a human-readable trust level.
 *
 * @param trustScore The numeric trust score (or undefined/-1 for no data)
 * @returns A categorized trust level: "Secure", "Moderate", or "Unknown"
 */
function categorizeTrustLevel(trustScore: number | undefined): string {
  // No data or invalid value
  if (trustScore === undefined || trustScore === -1) {
    return "Moderate";
  }

  // Secure: >= 7
  if (trustScore >= 7) {
    return "Secure";
  }

  // Moderate: >= 4 and < 7
  if (trustScore >= 4) {
    return "Moderate";
  }

  // Unknown: < 4
  return "Unknown";
}

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

  // Always add categorized trust level
  const trustLevel = categorizeTrustLevel(result.trustScore);
  formattedResult.push(`- Trust Level: ${trustLevel}`);

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

/**
 * Formats documentation results from multiple libraries with proper section headers.
 * For single library, returns content as-is.
 * For multiple libraries, adds headers and separators.
 *
 * @param results Array of library documentation results
 * @returns Formatted documentation string
 */
export function formatMultiLibraryDocs(
  results: Array<{ libraryId: string; docs: string }>
): string {
  if (results.length === 1) {
    // Single library - return as-is
    return results[0].docs;
  }

  // Multiple libraries - add section headers with separator between sections
  return results.map(({ libraryId, docs }) => `=== ${libraryId} ===\n${docs}`).join("\n\n");
}
