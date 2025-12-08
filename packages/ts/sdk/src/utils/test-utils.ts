import { HttpClient } from "@http";

export function newHttpClient(): HttpClient {
  const apiKey = process.env.CONTEXT7_API_KEY || process.env.API_KEY;

  if (!apiKey) {
    throw new Error("CONTEXT7_API_KEY or API_KEY environment variable is required for tests");
  }

  return new HttpClient({
    baseUrl: process.env.CONTEXT7_BASE_URL || "https://context7.com/api",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    retry: {
      retries: 3,
      backoff: (retryCount) => Math.exp(retryCount) * 50,
    },
    cache: "no-store",
  });
}
