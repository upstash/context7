import type { RequestHandler } from "express";
import { isIP } from "node:net";

const DEFAULT_HOSTED_ORIGINS = ["https://context7.com", "https://www.context7.com"];
const ALLOWED_METHODS = "GET,POST,OPTIONS,DELETE";
// Mcp-Method and Mcp-Name are SEP-2243 headers sent by modern browser clients.
const ALLOWED_HEADERS =
  "Content-Type, MCP-Session-Id, MCP-Protocol-Version, Mcp-Method, Mcp-Name, X-Context7-API-Key, Context7-API-Key, X-API-Key, Authorization";

function parseOrigin(value: string): URL | undefined {
  try {
    const url = new URL(value);
    if (
      url.origin !== value ||
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password
    ) {
      return undefined;
    }
    return url;
  } catch {
    return undefined;
  }
}

function normalizeConfiguredOrigins(value: string | undefined): Set<string> {
  const origins = (value ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  return new Set(
    [...DEFAULT_HOSTED_ORIGINS, ...origins].map((origin) => {
      const parsed = parseOrigin(origin);
      if (!parsed) throw new Error(`Invalid allowed origin: '${origin}'`);
      return parsed.origin;
    })
  );
}

export function isLoopbackHostname(hostname: string): boolean {
  const unwrapped = hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");
  if (unwrapped === "localhost") return true;
  if (isIP(unwrapped) === 4) return unwrapped.startsWith("127.");
  if (isIP(unwrapped) === 6) return new URL(`http://[${unwrapped}]`).hostname === "[::1]";
  return false;
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

export function createHttpSecurityMiddleware(
  bindHost: string,
  additionalHostedOrigins?: string
): RequestHandler {
  const isLocal = isLoopbackHostname(bindHost);
  const hostedOrigins = isLocal ? undefined : normalizeConfiguredOrigins(additionalHostedOrigins);
  const isOriginAllowed = isLocal
    ? isLoopbackOrigin
    : (origin: string) => hostedOrigins?.has(origin) === true;

  return (req, res, next) => {
    if (isLocal && !isLoopbackHost(req.headers.host)) {
      res.status(403).json({ error: "forbidden", message: "Untrusted Host header." });
      return;
    }

    const origin = req.headers.origin;
    if (origin !== undefined && !isOriginAllowed(origin)) {
      res.status(403).json({ error: "forbidden", message: "Untrusted Origin header." });
      return;
    }

    res.vary("Origin");
    if (origin !== undefined) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Methods", ALLOWED_METHODS);
      res.setHeader("Access-Control-Allow-Headers", ALLOWED_HEADERS);
    }

    if (req.method === "OPTIONS") {
      res.vary("Access-Control-Request-Method");
      res.vary("Access-Control-Request-Headers");
      res.sendStatus(204);
      return;
    }

    next();
  };
}
