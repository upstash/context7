import { getVercelOidcToken } from "@vercel/oidc";

const SEARCH_URL = "https://context7.com/api/v3/search";
const MINT_URL = "https://api.vercel.com/v1/integrations/marketplace/resources";
const REFRESH_MARGIN_MS = 30_000;

let cached: { token: string; expiresAt: number } | null = null;

export async function getContext7Token(): Promise<string> {
  if (cached && cached.expiresAt - Date.now() > REFRESH_MARGIN_MS) return cached.token;

  const storeId = process.env.CONTEXT7_STORE_ID;
  if (!storeId) throw new Error("Set CONTEXT7_STORE_ID to the ID of your Context7 resource.");

  const response = await fetch(`${MINT_URL}/${encodeURIComponent(storeId)}/token`, {
    method: "POST",
    headers: { Authorization: `Bearer ${await getVercelOidcToken()}` },
  });
  if (!response.ok) {
    throw new Error(`Vercel could not mint a Context7 token (HTTP ${response.status}).`);
  }

  const { token, expiresIn } = (await response.json()) as { token: string; expiresIn: number };
  cached = { token, expiresAt: Date.now() + expiresIn * 1000 };
  return token;
}

export interface SearchDocsInput {
  query: string;
  library?: string;
  version?: string;
}

export async function searchDocs(input: SearchDocsInput, signal?: AbortSignal): Promise<string> {
  const url = new URL(SEARCH_URL);
  url.searchParams.set("query", input.query);
  if (input.library) url.searchParams.set("library", input.library);
  if (input.version) url.searchParams.set("version", input.version);

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${await getContext7Token()}` },
    signal,
  });
  const text = await response.text();
  if (response.status === 401) cached = null;
  if (!response.ok) throw new Error(`Context7 Search failed (HTTP ${response.status}): ${text}`);
  return text;
}
