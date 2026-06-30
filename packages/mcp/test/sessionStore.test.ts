import { afterEach, describe, expect, test, vi } from "vitest";

import { createSessionStore } from "../src/lib/sessionStore.js";

describe("createSessionStore (no Redis configured)", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  test("runs statelessly without Redis credentials", async () => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    vi.spyOn(console, "error").mockImplementation(() => {});

    const store = createSessionStore();

    // Would throw inside getRedis() if it tried to use Redis without credentials.
    await store.create("s");

    // Accepts any session ID, tracking nothing — so unknown sessions are accepted too.
    expect(await store.refresh("s")).toBe(true);
    expect(await store.refresh("never-created")).toBe(true);

    await store.delete("s");
    expect(await store.refresh("s")).toBe(true);
  });
});
