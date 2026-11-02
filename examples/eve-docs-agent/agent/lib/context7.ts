import { Context7 } from "@upstash/context7-sdk";
import { getVercelOidcToken } from "@vercel/oidc";

const MINT_URL = "https://api.vercel.com/v1/integrations/marketplace/resources";
const REFRESH_MARGIN_MS = 30_000;

let cached: { token: string; expiresAt: number } | null = null;

async function getResourceToken(): Promise<string> {
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

export const context7 = new Context7({ authToken: getResourceToken });
