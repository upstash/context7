import { describe, expect, test } from "vitest";
import {
  isLoopbackHost,
  isLoopbackHostname,
  isLoopbackOrigin,
  normalizeBindHost,
} from "./http-security.js";

describe("HTTP bind host normalization", () => {
  test.each([
    ["127.0.0.1", "127.0.0.1"],
    ["127.1", "127.0.0.1"],
    ["LOCALHOST.", "localhost."],
    ["::1", "::1"],
    ["[0:0:0:0:0:0:0:1]", "::1"],
    ["0.0.0.0", "0.0.0.0"],
  ])("normalizes %s to %s", (input, expected) => {
    expect(normalizeBindHost(input)).toBe(expected);
  });

  test.each(["", "   ", "user@example.com", "localhost:3000", "localhost/path"])(
    "rejects invalid host %j",
    (host) => {
      expect(() => normalizeBindHost(host)).toThrow();
    }
  );
});

describe("loopback request validation", () => {
  test("recognizes loopback hostname spellings", () => {
    expect(isLoopbackHostname("localhost")).toBe(true);
    expect(isLoopbackHostname("localhost.")).toBe(true);
    expect(isLoopbackHostname("127.0.0.2")).toBe(true);
    expect(isLoopbackHostname("127.1")).toBe(true);
    expect(isLoopbackHostname("::1")).toBe(true);
    expect(isLoopbackHostname("[0:0:0:0:0:0:0:1]")).toBe(true);
    expect(isLoopbackHostname("0.0.0.0")).toBe(false);
  });

  test("accepts literal IPv4, IPv6, and localhost origins", () => {
    expect(isLoopbackOrigin("http://localhost:5173")).toBe(true);
    expect(isLoopbackOrigin("https://localhost")).toBe(true);
    expect(isLoopbackOrigin("http://127.0.0.1:8080")).toBe(true);
    expect(isLoopbackOrigin("http://[::1]:3000")).toBe(true);
    expect(isLoopbackOrigin("http://[0:0:0:0:0:0:0:1]:3000")).toBe(true);
  });

  test("rejects null, malformed, userinfo, paths, and lookalike origins", () => {
    expect(isLoopbackOrigin("null")).toBe(false);
    expect(isLoopbackOrigin("not a URL")).toBe(false);
    expect(isLoopbackOrigin("http://user@localhost:3000")).toBe(false);
    expect(isLoopbackOrigin("http://localhost:3000/mcp")).toBe(false);
    expect(isLoopbackOrigin("http://localhost.attacker.example")).toBe(false);
  });

  test("accepts literal loopback Host values with any port", () => {
    expect(isLoopbackHost("localhost:3000")).toBe(true);
    expect(isLoopbackHost("127.0.0.1:43117")).toBe(true);
    expect(isLoopbackHost("[::1]:3000")).toBe(true);
  });

  test("rejects missing, malformed, userinfo, and lookalike Host values", () => {
    expect(isLoopbackHost(undefined)).toBe(false);
    expect(isLoopbackHost("user@localhost")).toBe(false);
    expect(isLoopbackHost("localhost.attacker.example")).toBe(false);
    expect(isLoopbackHost("127.0.0.1/path")).toBe(false);
  });
});
