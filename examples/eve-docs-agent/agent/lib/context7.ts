import { Context7 } from "@upstash/context7-sdk";
import { getVercelOidcToken } from "@vercel/oidc";

// Mint a fresh token this many milliseconds before the current one expires.
const REFRESH_MARGIN_MS = 30_000;

let client: Context7 | undefined;

/**
 * The Context7 client. It uses `CONTEXT7_API_KEY` when it is set. Otherwise it uses the
 * Context7 integration from the Vercel Marketplace: Vercel mints a short-lived Context7 token
 * for the resource in `CONTEXT7_STORE_ID`, and no secret is stored in the project.
 */
export function getContext7(): Context7 {
  if (!client) {
    if (process.env.CONTEXT7_API_KEY) {
      client = new Context7();
    } else if (process.env.CONTEXT7_STORE_ID) {
      client = new Context7({ authToken: resourceTokenProvider(process.env.CONTEXT7_STORE_ID) });
    } else {
      throw new Error(
        "Context7 is not configured. Install the Context7 integration from the Vercel " +
          "Marketplace and set CONTEXT7_STORE_ID, or set CONTEXT7_API_KEY to a key from " +
          "https://context7.com/dashboard."
      );
    }
  }
  return client;
}

/** Returns a cached resource token, and mints a new one shortly before it expires. */
function resourceTokenProvider(storeId: string): () => Promise<string> {
  let cached: Promise<{ token: string; expiresAt: number }> | undefined;

  return async () => {
    const current = cached && (await cached.catch(() => undefined));
    if (current && current.expiresAt - REFRESH_MARGIN_MS > Date.now()) return current.token;

    cached = mintResourceToken(storeId);
    return (await cached).token;
  };
}

async function mintResourceToken(storeId: string): Promise<{ token: string; expiresAt: number }> {
  const response = await fetch(
    `https://api.vercel.com/v1/integrations/marketplace/resources/${encodeURIComponent(storeId)}/token`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${await getVercelOidcToken()}` },
    }
  );
  if (!response.ok) {
    throw new Error(
      `Vercel could not mint a Context7 token for ${storeId} (HTTP ${response.status}). ` +
        "Check that the Context7 resource is connected to this project and environment."
    );
  }
  const { token, expiresIn } = (await response.json()) as { token: string; expiresIn: number };
  return { token, expiresAt: Date.now() + expiresIn * 1000 };
}
