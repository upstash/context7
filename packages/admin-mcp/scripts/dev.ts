// Local server without Vercel: serves vercel.json's rewrites from the same api/ handlers.
// `pnpm dev`, then connect an MCP client to http://localhost:3100/mcp. The OAuth metadata names this
// local URL, as clients require, so tokens are issued for it: the management API behind it
// (CONTEXT7_API_URL) must list it in ADMIN_OAUTH_ALLOWED_AUDIENCES. A `ctx7sk-` key with Management
// access works against any API.
import { readFileSync } from "node:fs";
import { serve } from "@hono/node-server";

type Route = { fetch(request: Request): Response | Promise<Response> };

const { rewrites } = JSON.parse(
  readFileSync(new URL("../vercel.json", import.meta.url), "utf-8")
) as {
  rewrites: { source: string; destination: string }[];
};
const port = Number(process.env.PORT || 3100);
// Read by src/http.ts when the handlers load below.
process.env.RESOURCE_URL ??= `http://localhost:${port}`;

const routes = new Map<string, Route>();
for (const { source, destination } of rewrites) {
  routes.set(source, (await import(`..${destination}.ts`)).default as Route);
}

serve(
  {
    port,
    hostname: "127.0.0.1",
    fetch: (request) =>
      routes.get(new URL(request.url).pathname)?.fetch(request) ??
      new Response("Not found", { status: 404 }),
  },
  () => console.log(`Context7 Admin MCP on http://localhost:${port}/mcp`)
).on("error", (error: NodeJS.ErrnoException) => {
  console.error(
    error.code === "EADDRINUSE"
      ? `Port ${port} is in use: a server is already running there. Stop it, or set PORT.`
      : error
  );
  process.exit(1);
});
