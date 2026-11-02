import { getVercelOidcToken } from "@vercel/oidc";

const SEARCH_URL = "https://context7.com/api/v3/search";
const MINT_URL = "https://api.vercel.com/v1/integrations/marketplace/resources";
/** Mint a new token this long before the current one expires. */
const REFRESH_MARGIN_MS = 30_000;

let cached: { token: string; expiresAt: number } | null = null;

/**
 * A short-lived Context7 token for this deployment's Context7 resource. Vercel mints it from
 * the deployment's own OIDC token, so no API key is stored anywhere. Tokens live 300 seconds;
 * this keeps one and mints a new one shortly before it expires.
 */
export async function getContext7Token(): Promise<string> {
  if (cached && cached.expiresAt - Date.now() > REFRESH_MARGIN_MS) return cached.token;

  const storeId = process.env.CONTEXT7_STORE_ID;
  if (!storeId) {
    throw new Error(
      "CONTEXT7_STORE_ID is not set. Set it to the ID of your Context7 resource in Vercel."
    );
  }

  const response = await fetch(`${MINT_URL}/${encodeURIComponent(storeId)}/token`, {
    method: "POST",
    headers: { Authorization: `Bearer ${await getVercelOidcToken()}` },
  });
  if (!response.ok) {
    // 404 also means token minting is not enabled yet for this team or integration.
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

/** Ask Context7 Search a documentation question and return ranked snippets as text. */
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
