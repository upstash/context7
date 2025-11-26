import { SearchResponse, SearchResult } from "./types.js";

/**
 * Maps numeric source reputation score to an interpretable label for LLM consumption.
 *
 * @returns One of: "High", "Medium", "Low", or "Unknown"
 */
function getSourceReputationLabel(
  sourceReputation?: number
): "High" | "Medium" | "Low" | "Unknown" {
  if (sourceReputation === undefined || sourceReputation < 0) return "Unknown";
  if (sourceReputation >= 7) return "High";
  if (sourceReputation >= 4) return "Medium";
  return "Low";
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

  // Always add categorized source reputation
  const reputationLabel = getSourceReputationLabel(result.trustScore);
  formattedResult.push(`- Source Reputation: ${reputationLabel}`);

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
 * Masks an API key by showing only the first 10 characters and last 4 characters.
 * This prevents full API keys from being exposed in logs while maintaining some
 * identifiability for debugging.
 *
 * @param apiKey The API key to mask
 * @returns Masked API key string (e.g., "ctx7sk-abc...xyz1") or "[NO-API-KEY]" if no key provided
 */
export function maskApiKey(apiKey: string): string {
  if (apiKey.length <= 14) {
    // If the key is too short to mask meaningfully, just show first part
    return apiKey.substring(0, 7) + "...";
  }

  const firstPart = apiKey.substring(0, 10);
  const lastPart = apiKey.substring(apiKey.length - 4);
  return `${firstPart}...${lastPart}`;
}
