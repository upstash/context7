import { config } from "dotenv";

config({ path: [".env.local", ".env"], quiet: true });

const { agent } = await import("./lib/agent");

const promptArguments = process.argv.slice(2);
const prompt =
  (promptArguments[0] === "--" ? promptArguments.slice(1) : promptArguments).join(" ") ||
  "How do I revalidate a page on demand with the latest version of Next.js?";

const result = await agent.generate({ prompt });

console.log(result.text);
