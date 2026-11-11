// SEP-2127 server card at `{streamable-http-url}/server-card`, as the docs MCP serves it.
import { RESOURCE_URL, withCors } from "../src/http.js";
import { SERVER_ICONS, SERVER_VERSION } from "../src/server.js";

export const serverCard = {
  $schema: "https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json",
  name: "io.github.upstash/context7-admin",
  title: "Context7 Admin",
  description: "Manage Context7 teamspaces, libraries, Docs7 sites and Ask sites.",
  version: SERVER_VERSION,
  websiteUrl: "https://context7.com",
  icons: SERVER_ICONS,
  remotes: [
    {
      type: "streamable-http",
      url: RESOURCE_URL,
      headers: [
        {
          name: "Authorization",
          description:
            "Optional. Sign in with OAuth, or send a Context7 API key. A key can make changes only when it was created with Write access.",
          isRequired: false,
          isSecret: true,
          value: "Bearer {api_key}",
          variables: {
            api_key: { description: "Context7 API key", isSecret: true, placeholder: "ctx7sk-..." },
          },
        },
      ],
    },
  ],
};

export default {
  fetch: (request: Request) =>
    withCors(
      request,
      () =>
        new Response(JSON.stringify(serverCard), {
          headers: {
            "Content-Type": "application/mcp-server-card+json",
            "Cache-Control": "public, max-age=3600",
          },
        })
    ),
};
