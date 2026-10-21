#!/usr/bin/env node

import { toNodeHandler } from "@modelcontextprotocol/node";
import express from "express";
import {
  createAdminHandler,
  MCP_PATH,
  METADATA_PATH,
  OAUTH_AUTH_SERVER_URL,
  protectedResourceMetadata,
} from "./http.js";
import { SERVER_VERSION } from "./server.js";

const PORT = Number(process.env.PORT || 8080);

const handler = createAdminHandler();
const mcp = toNodeHandler(handler, {
  onerror: (error) => console.error("MCP node adapter error:", error),
});

const app = express();
app.set("trust proxy", ["loopback", "linklocal", "uniquelocal", "100.64.0.0/10"]);

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS,DELETE");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, MCP-Session-Id, MCP-Protocol-Version, Mcp-Method, Mcp-Name, Authorization"
  );
  // Browser clients need WWW-Authenticate to start OAuth from the 401.
  res.setHeader("Access-Control-Expose-Headers", "WWW-Authenticate, MCP-Session-Id");
  if (req.method === "OPTIONS") {
    res.sendStatus(200);
    return;
  }
  next();
});

app.all(MCP_PATH, (req, res) => mcp(req, res));

app.get("/ping", (_req, res) => {
  res.json({ status: "ok", message: "pong" });
});

app.get(METADATA_PATH, (_req, res) => {
  res.json(protectedResourceMetadata());
});

// Clients that only read the resource origin find Clerk's metadata here.
app.get("/.well-known/oauth-authorization-server", async (_req, res) => {
  try {
    const upstream = await fetch(
      `${OAUTH_AUTH_SERVER_URL}/.well-known/oauth-authorization-server`,
      {
        signal: AbortSignal.timeout(10_000),
      }
    );
    if (!upstream.ok) {
      res.status(upstream.status).json({
        error: "upstream_error",
        message: "Failed to fetch authorization server metadata",
      });
      return;
    }
    res.json(await upstream.json());
  } catch (error) {
    console.error("[OAuth] Error fetching OAuth metadata:", error);
    res
      .status(502)
      .json({ error: "proxy_error", message: "Failed to proxy authorization server metadata" });
  }
});

app.use((_req, res) => {
  res.status(404).json({ error: "not_found", message: `Use ${MCP_PATH} for MCP.` });
});

const server = app.listen(PORT, () => {
  console.error(
    `Context7 Admin MCP Server v${SERVER_VERSION} on http://localhost:${PORT}${MCP_PATH}`
  );
});

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    server.close(() => void handler.close().finally(() => process.exit(0)));
    server.closeIdleConnections();
  });
}
