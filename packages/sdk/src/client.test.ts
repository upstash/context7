import { afterEach, describe, expect, test, vi } from "vitest";
import { Context7 } from "./client";
import { Context7Error } from "@error";

describe("Context7 Client", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  test("creates a client with an explicit API key", () => {
    expect(new Context7({ apiKey: "ctx7sk-config" })).toBeDefined();
  });

  test("creates a client from the environment", () => {
    vi.stubEnv("CONTEXT7_API_KEY", "ctx7sk-environment");

    expect(new Context7()).toBeDefined();
  });

  test("requires an API key", () => {
    vi.stubEnv("CONTEXT7_API_KEY", "");

    expect(() => new Context7({ apiKey: "" })).toThrow(Context7Error);
    expect(() => new Context7()).toThrow("API key is required");
  });

  test("prefers the configured API key over the environment", () => {
    vi.stubEnv("CONTEXT7_API_KEY", "invalid-environment-key");
    const warn = vi.spyOn(console, "warn");

    new Context7({ apiKey: "ctx7sk-config" });

    expect(warn).not.toHaveBeenCalled();
  });
});
