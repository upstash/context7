import type express from "express";

function stripIpv4MappedPrefix(ip: string): string {
  return ip.replace(/^::ffff:/i, "");
}

/**
 * Returns true for RFC1918, CGNAT, loopback, link-local, and IPv6 private ranges.
 */
export function isPrivateOrLocalIp(ip: string): boolean {
  const plainIp = stripIpv4MappedPrefix(ip).toLowerCase();

  if (plainIp.includes(".")) {
    return (
      plainIp.startsWith("10.") ||
      plainIp.startsWith("192.168.") ||
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(plainIp) ||
      /^100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\./.test(plainIp) ||
      plainIp.startsWith("127.") ||
      plainIp.startsWith("169.254.")
    );
  }

  // ::1 loopback in any textual form (e.g. "0::1", "0:0:0:0:0:0:0:1")
  if (/^[0:]+1$/.test(plainIp)) {
    return true;
  }

  // First hextets in fe80::/10 and fc00::/7 start with a non-zero digit, so a
  // valid textual form always spells out all 4 digits.

  // fe80::/10 link-local
  if (/^fe[89ab][0-9a-f]:/.test(plainIp)) {
    return true;
  }

  // fc00::/7 unique local
  if (/^f[cd][0-9a-f]{2}:/.test(plainIp)) {
    return true;
  }

  return false;
}

function pickClientIpFromForwardedList(ipList: string[]): string | undefined {
  for (const ip of ipList) {
    const plainIp = stripIpv4MappedPrefix(ip);
    if (!isPrivateOrLocalIp(plainIp)) {
      return plainIp;
    }
  }

  if (ipList.length === 0) {
    return undefined;
  }

  return stripIpv4MappedPrefix(ipList[0]);
}

/**
 * Extract client IP address from request headers.
 * Handles X-Forwarded-For header for proxied requests.
 */
export function getClientIp(req: express.Request): string | undefined {
  const forwardedFor = req.headers["x-forwarded-for"] || req.headers["X-Forwarded-For"];

  if (forwardedFor) {
    const ips = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
    const ipList = ips.split(",").map((ip) => ip.trim());
    return pickClientIpFromForwardedList(ipList);
  }

  if (req.socket?.remoteAddress) {
    return stripIpv4MappedPrefix(req.socket.remoteAddress);
  }

  return undefined;
}
