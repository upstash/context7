import { Context7 } from "@upstash/context7-sdk";
import { getIntegrationToken } from "@vercel/integrations";

let client: Context7 | undefined;

export function getContext7(): Context7 {
  if (client) return client;

  if (process.env.CONTEXT7_API_KEY) {
    client = new Context7();
  } else {
    const resourceId = process.env.CONTEXT7_RESOURCE_ID?.trim();
    if (!resourceId) {
      throw new Error("Set CONTEXT7_API_KEY or CONTEXT7_RESOURCE_ID for the connected Vercel resource");
    }
    client = new Context7({ authToken: () => getIntegrationToken(resourceId) });
  }
  return client;
}
