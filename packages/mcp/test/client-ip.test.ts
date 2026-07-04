import { describe, expect, test } from "vitest";
import type express from "express";
import { getClientIp, isPrivateOrLocalIp } from "../src/lib/client-ip.js";

describe("isPrivateOrLocalIp", () => {
  test.each([
    "10.0.0.1",
    "192.168.1.1",
    "172.16.0.1",
    "127.0.0.1",
    "169.254.1.1",
    "::1",
    "fe80::1",
    "fc00::1",
    "fd12::1",
    "::ffff:127.0.0.1",
  ])("treats %s as private or local", (ip) => {
    expect(isPrivateOrLocalIp(ip)).toBe(true);
  });

  test.each(["8.8.8.8", "203.0.113.10", "2001:db8::1", "::ffff:8.8.8.8"])(
    "treats %s as public",
    (ip) => {
      expect(isPrivateOrLocalIp(ip)).toBe(false);
    }
  );
});

describe("getClientIp", () => {
  function makeRequest(headers: Record<string, string | string[]>): express.Request {
    return {
      headers,
      socket: undefined,
    } as express.Request;
  }

  test("skips loopback and link-local entries in X-Forwarded-For", () => {
    const req = makeRequest({
      "x-forwarded-for": "127.0.0.1, 8.8.8.8",
    });

    expect(getClientIp(req)).toBe("8.8.8.8");
  });

  test("skips RFC1918 and returns the first public forwarded IP", () => {
    const req = makeRequest({
      "x-forwarded-for": "10.0.0.1, 192.168.0.2, 203.0.113.10",
    });

    expect(getClientIp(req)).toBe("203.0.113.10");
  });

  test("skips IPv6 loopback and private ranges in X-Forwarded-For", () => {
    const req = makeRequest({
      "x-forwarded-for": "::1, fe80::1, fc00::1, 2001:db8::5",
    });

    expect(getClientIp(req)).toBe("2001:db8::5");
  });

  test("falls back to the first forwarded IP when all entries are private", () => {
    const req = makeRequest({
      "x-forwarded-for": "127.0.0.1, 10.0.0.1",
    });

    expect(getClientIp(req)).toBe("127.0.0.1");
  });

  test("uses socket remote address when X-Forwarded-For is absent", () => {
    const req = {
      headers: {},
      socket: { remoteAddress: "::ffff:203.0.113.10" },
    } as express.Request;

    expect(getClientIp(req)).toBe("203.0.113.10");
  });
});
