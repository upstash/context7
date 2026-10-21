// Vercel Function for the MCP endpoint (/mcp, see vercel.json). The handler is built from src/ by `pnpm build`.
import { createAdminHandler, withCors } from "../dist/http.js";

const handler = createAdminHandler();

export default {
  fetch: (request) => withCors(request, handler.fetch),
};
