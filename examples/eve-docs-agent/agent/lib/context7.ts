import { Context7 } from "@upstash/context7-sdk";

let client: Context7 | undefined;

export function getContext7(): Context7 {
  if (!client) {
    if (!process.env.CONTEXT7_API_KEY) {
      throw new Error(
        "CONTEXT7_API_KEY is not set. Install the Context7 integration from the Vercel " +
          "Marketplace, or run `vercel env pull` for local development."
      );
    }
    client = new Context7();
  }
  return client;
}
