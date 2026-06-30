import { afterEach, describe, expect, test, vi } from "vitest";

import { createMemorySessionStore, createSessionStore } from "../src/lib/sessionStore.js";

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const REFRESH_THRESHOLD_MS = 24 * 60 * 60 * 1000;

describe("createMemorySessionStore", () => {
  test("refreshes a created session and rejects unknown ones", async () => {
    const store = createMemorySessionStore();
    await store.create("a");

    expect(await store.refresh("a")).toBe(true);
    expect(await store.refresh("unknown")).toBe(false);
  });

  test("rejects a session after it is deleted", async () => {
    const store = createMemorySessionStore();
    await store.create("a");
    await store.delete("a");

    expect(await store.refresh("a")).toBe(false);
  });

  test("expires a session once its TTL elapses", async () => {
    vi.useFakeTimers();
    try {
      const store = createMemorySessionStore();
      await store.create("a");

      vi.advanceTimersByTime(SESSION_TTL_MS + 1000);

      expect(await store.refresh("a")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  test("extends the TTL when a session is close to expiring", async () => {
    vi.useFakeTimers();
    try {
      const store = createMemorySessionStore();
      await store.create("a");

      // Advance to within the refresh threshold, then refresh to extend.
      vi.advanceTimersByTime(SESSION_TTL_MS - REFRESH_THRESHOLD_MS + 1000);
      expect(await store.refresh("a")).toBe(true);

      // Without the extension the session would now be expired; with it, still valid.
      vi.advanceTimersByTime(REFRESH_THRESHOLD_MS);
      expect(await store.refresh("a")).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("createSessionStore", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  test("falls back to the in-memory store when Redis is not configured", async () => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    vi.spyOn(console, "error").mockImplementation(() => {});

    const store = createSessionStore();

    // Would throw inside getRedis() if it tried to use Redis without credentials.
    await store.create("s");
    expect(await store.refresh("s")).toBe(true);
  });
});
