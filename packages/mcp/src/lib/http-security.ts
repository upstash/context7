import type { RequestHandler } from "express";
import { isIP } from "node:net";

const ALLOWED_METHODS = "GET,POST,OPTIONS,DELETE";
// Mcp-Method and Mcp-Name are SEP-2243 headers sent by modern browser clients.
const ALLOWED_HEADERS =
  "Content-Type, MCP-Session-Id, MCP-Protocol-Version, Mcp-Method, Mcp-Name, X-Context7-API-Key, Context7-API-Key, X-API-Key, Authorization";

function parseOrigin(value: string): URL | undefined {
  try {
    const url = new URL(value);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    ) {
      return undefined;
    }
    return url;
  } catch {
    return undefined;
  }
}

export function normalizeBindHost(value: string): string {
  const host = value.trim().toLowerCase();
  if (!host) throw new Error("HTTP host must not be empty.");

  try {
    // URL parsing canonicalizes numeric IPv4 forms such as 127.1. IPv6 needs
    // brackets while parsing, but Node's listener expects the returned bare address.
    const authority = isIP(host) === 6 ? `[${host}]` : host;
    const url = new URL(`http://${authority}`);
    if (
      url.username ||
      url.password ||
      url.port ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    ) {
      throw new Error();
    }

    return url.hostname.replace(/^\[|\]$/g, "");
  } catch {
    throw new Error(`Invalid HTTP host: '${value}'.`);
  }
}

export function isLoopbackHostname(hostname: string): boolean {
  try {
    const normalized = normalizeBindHost(hostname).replace(/\.$/, "");
    if (normalized === "localhost") return true;
    if (isIP(normalized) === 4) return normalized.startsWith("127.");
    return normalized === "::1";
  } catch {
    return false;
  }
}

export function isLoopbackOrigin(origin: string): boolean {
  const url = parseOrigin(origin);
  return url !== undefined && isLoopbackHostname(url.hostname);
}

export function isLoopbackHost(hostHeader: string | undefined): boolean {
  if (!hostHeader) return false;

  try {
    const url = new URL(`http://${hostHeader}`);
    return (
      !url.username &&
      !url.password &&
      url.pathname === "/" &&
      !url.search &&
      !url.hash &&
      isLoopbackHostname(url.hostname)
    );
  } catch {
    return false;
  }
}

export function createHttpSecurityMiddleware(bindHost: string): RequestHandler {
  const isLocal = isLoopbackHostname(bindHost);

  return (req, res, next) => {
    const origin = req.headers.origin;
    if (isLocal) {
      res.vary("Origin");
      if (req.method === "OPTIONS") {
        res.vary("Access-Control-Request-Method");
        res.vary("Access-Control-Request-Headers");
      }

      if (!isLoopbackHost(req.headers.host)) {
        res.status(403).json({ error: "forbidden", message: "Untrusted Host header." });
        return;
      }

      if (origin !== undefined && !isLoopbackOrigin(origin)) {
        res.status(403).json({ error: "forbidden", message: "Untrusted Origin header." });
        return;
      }
    }

    // Hosted authentication is header-only, so wildcard CORS keeps browser MCP
    // clients compatible without exposing ambient credentials.
    const allowedOrigin = isLocal ? origin : "*";
    if (allowedOrigin !== undefined) res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
    res.setHeader("Access-Control-Allow-Methods", ALLOWED_METHODS);
    res.setHeader("Access-Control-Allow-Headers", ALLOWED_HEADERS);

    if (req.method === "OPTIONS") {
      res.sendStatus(204);
      return;
    }

    next();
  };
}
