import { randomBytes } from "node:crypto";
import { Redis } from "@upstash/redis";
import { afterAll, describe, expect, test } from "vitest";
import { CODE_TASK_TTL_MS, type CodeTaskRecord } from "../src/lib/code-task.js";
import {
  CLAIM_SCRIPT,
  PUT_SCRIPT,
  RedisCodeTaskStore,
  redisCodeTaskStoreFromEnv,
  type TaskRedis,
} from "../src/lib/code-task-redis.js";

const T0 = 1_800_000_000_000;

function record(fields: Partial<CodeTaskRecord> = {}): CodeTaskRecord {
  return {
    tool: "grep-code",
    request: { libraryId: "/honojs/hono", version: "v4.7.0", pattern: "serve", glob: [] },
    createdAt: T0,
    updatedAt: T0,
    caller: "k:abc",
    pollSeconds: 30,
    lastCheckAt: T0,
    status: "working",
    message: "The source is being indexed.",
    ...fields,
  };
}

describe("RedisCodeTaskStore", () => {
  test("writes one hash per task that expires an hour after the task's creation", async () => {
    const calls: { script: string; keys: string[]; args: string[] }[] = [];
    const redis: TaskRedis = {
      hget: async () => null,
      eval: async (script, keys, args) => {
        calls.push({ script, keys, args });
        return 1;
      },
    };
    const store = new RedisCodeTaskStore(redis);
    await store.put("task1", record({ lastCheckAt: T0 + 5 }));
    expect(calls[0]).toEqual({
      script: PUT_SCRIPT,
      keys: ["mcp:code-task:task1"],
      args: [
        JSON.stringify(record({ lastCheckAt: T0 + 5 })),
        "working",
        String(T0 + 5),
        String(T0 + CODE_TASK_TTL_MS),
      ],
    });
    expect(await store.claimCheck("task1", T0 + 60_000, 45_000)).toBe(true);
    expect(calls[1]).toEqual({
      script: CLAIM_SCRIPT,
      keys: ["mcp:code-task:task1"],
      args: [String(T0 + 60_000), "45000"],
    });
  });

  test("reads a record, and reads a missing or broken one as no task", async () => {
    const values: Record<string, unknown> = {
      "mcp:code-task:ok": JSON.stringify(record()),
      "mcp:code-task:broken": "{not json",
      "mcp:code-task:other": JSON.stringify({ hello: 1 }),
    };
    const store = new RedisCodeTaskStore({
      hget: async (key, field) => (field === "record" ? (values[key] ?? null) : null),
      eval: async () => 0,
    });
    expect(await store.get("ok")).toEqual(record());
    expect(await store.get("missing")).toBeNull();
    expect(await store.get("broken")).toBeNull();
    expect(await store.get("other")).toBeNull();
  });

  test("has no store without the database's URL and token", () => {
    const saved = { ...process.env };
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    try {
      expect(redisCodeTaskStoreFromEnv()).toBeNull();
      process.env.UPSTASH_REDIS_REST_URL = "https://example.upstash.io";
      expect(redisCodeTaskStoreFromEnv()).toBeNull();
    } finally {
      process.env = saved;
    }
  });
});

// Runs the scripts on a real database. Set MCP_TASKS_TEST_REDIS_REST_URL and
// MCP_TASKS_TEST_REDIS_REST_TOKEN to a test database to run it.
const url = process.env.MCP_TASKS_TEST_REDIS_REST_URL;
const token = process.env.MCP_TASKS_TEST_REDIS_REST_TOKEN;

describe.skipIf(!url || !token)("RedisCodeTaskStore on a real database", () => {
  const redis = new Redis({
    url: url ?? "https://unset.invalid",
    token: token ?? "unset",
    automaticDeserialization: false,
  });
  // Two stores stand for two pods.
  const podA = new RedisCodeTaskStore(redis);
  const podB = new RedisCodeTaskStore(redis);
  const ids: string[] = [];
  const newId = () => {
    const id = `test-${randomBytes(8).toString("hex")}`;
    ids.push(id);
    return id;
  };
  const now = Date.now();

  afterAll(async () => {
    if (ids.length) await redis.del(...ids.map((id) => `mcp:code-task:${id}`));
  });

  test("a task written on one pod is read on another, with its expiry", async () => {
    const id = newId();
    const task = record({ createdAt: now, lastCheckAt: now });
    await podA.put(id, task);
    expect(await podB.get(id)).toEqual(task);
    const ttl = await redis.pttl(`mcp:code-task:${id}`);
    expect(ttl).toBeGreaterThan(CODE_TASK_TTL_MS - 60_000);
    expect(ttl).toBeLessThanOrEqual(CODE_TASK_TTL_MS);
    expect(await podB.get("test-unknown")).toBeNull();
  });

  test("only one pod takes a check, and the next is taken after the gap", async () => {
    const id = newId();
    await podA.put(id, record({ createdAt: now, lastCheckAt: now }));
    expect(await podA.claimCheck(id, now + 44_000, 45_000)).toBe(false);
    const taken = await Promise.all([
      podA.claimCheck(id, now + 60_000, 45_000),
      podB.claimCheck(id, now + 60_000, 45_000),
    ]);
    expect(taken.filter(Boolean)).toHaveLength(1);
    expect(await podB.claimCheck(id, now + 90_000, 45_000)).toBe(false);
    expect(await podB.claimCheck(id, now + 105_000, 45_000)).toBe(true);
    expect(await podA.claimCheck("test-unknown", now, 0)).toBe(false);
  });

  test("the first final status wins", async () => {
    const id = newId();
    const task = record({ createdAt: now, lastCheckAt: now });
    await podA.put(id, task);
    await podA.put(id, { ...task, status: "cancelled" });
    await podB.put(id, { ...task, status: "completed", result: { content: [] } });
    expect((await podA.get(id))?.status).toBe("cancelled");
    expect(await podB.claimCheck(id, now + 600_000, 0)).toBe(false);
  });
});
