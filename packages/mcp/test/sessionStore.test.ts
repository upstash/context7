import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createSessionStore } from "../src/lib/sessionStore.js";

beforeEach(() => {
  vi.stubEnv("UPSTASH_REDIS_REST_URL", undefined);
  vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", undefined);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("createSessionStore without Redis credentials", () => {
  test("returns a no-op store", async () => {
    const store = createSessionStore();
    await expect(store.create("some-session-id")).resolves.toBeUndefined();
    await expect(store.refresh("some-session-id")).resolves.toBe(true);
    await expect(store.delete("some-session-id")).resolves.toBeUndefined();
  });

  test("warns about missing credentials", () => {
    createSessionStore();
    expect(console.warn).toHaveBeenCalledTimes(1);
  });
});

describe("createSessionStore with Redis credentials", () => {
  test("constructs the Redis-backed store without throwing", () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://example.upstash.io");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "fake-token");
    expect(() => createSessionStore()).not.toThrow();
  });
});
