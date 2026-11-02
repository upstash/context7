import { Context7 } from "@upstash/context7-sdk";

let client: Context7 | undefined;

export function getContext7(): Context7 {
  if (!client) {
    if (!process.env.CONTEXT7_API_KEY) {
      throw new Error(
        "CONTEXT7_API_KEY is not set. Create a key at https://context7.com/dashboard and add " +
          "it to your Vercel project, or to .env.local for local runs."
      );
    }
    client = new Context7();
  }
  return client;
}
