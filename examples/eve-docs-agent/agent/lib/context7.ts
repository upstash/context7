import { Context7 } from "@upstash/context7-sdk";
import { getIntegrationToken } from "@vercel/integrations";

let client: Context7 | undefined;

/**
 * The Context7 client. It uses `CONTEXT7_API_KEY` when it is set. Otherwise it uses the
 * Context7 integration from the Vercel Marketplace: Vercel mints a short-lived Context7 token
 * for the Context7 resource connected to this project, so no secret is stored.
 */
export function getContext7(): Context7 {
  client ??= process.env.CONTEXT7_API_KEY
    ? new Context7()
    : new Context7({ authToken: () => getIntegrationToken("context7") });
  return client;
}
