// Vercel Function for the MCP endpoint (/mcp, see vercel.json). Vercel compiles it and src/ itself; vercel.json turns the package build off.
import { createAdminHandler, withCors } from "../src/http.js";

const handler = createAdminHandler();

export default {
  fetch: (request: Request) => withCors(request, handler),
};
