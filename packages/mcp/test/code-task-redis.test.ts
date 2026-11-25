import { randomBytes } from "node:crypto";
import { Redis } from "@upstash/redis";
import { afterAll, describe, expect, test } from "vitest";
import { CODE_TASK_TTL_MS, type CodeTaskRecord } from "../src/lib/code-task.js";
import {
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
    status: "working",
    message: "The source is being indexed.",
    ...fields,
  };
}

describe("RedisCodeTaskStore", () => {
  test("keys a task by its ID and lets it expire after the TTL", async () => {
    const calls: { keys: string[]; args: string[] }[] = [];
    const store = new RedisCodeTaskStore({
      eval: async (_script, keys, args) => {
        calls.push({ keys, args });
        return 1;
      },
    });
    expect(await store.put("task1", record())).toBe(true);
    expect(calls[0]?.keys).toEqual(["mcp:code-task:task1"]);
    expect(calls[0]?.args.at(-1)).toBe(String(T0 + CODE_TASK_TTL_MS));
  });

  test("reads a missing or broken record as no task", async () => {
    const values: Record<string, unknown> = {
      "mcp:code-task:ok": JSON.stringify(record()),
      "mcp:code-task:broken": "{not json",
      "mcp:code-task:other": JSON.stringify({ hello: 1 }),
    };
    const redis: TaskRedis = { eval: async (_script, keys) => values[keys[0]!] ?? null };
    const store = new RedisCodeTaskStore(redis);
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
  const keys: string[] = [];
  const newId = (prefix: string) => {
    const id = `test-${randomBytes(8).toString("hex")}`;
    keys.push(`${prefix}${id}`);
    return id;
  };
  const now = Date.now();

  afterAll(async () => {
    if (keys.length) await redis.del(...keys);
  });

  test("a task written on one pod is read on another, with its expiry", async () => {
    const id = newId("mcp:code-task:");
    const task = record({ createdAt: now });
    expect(await podA.put(id, task)).toBe(true);
    expect(await podB.get(id)).toEqual(task);
    const ttl = await redis.pttl(`mcp:code-task:${id}`);
    expect(ttl).toBeGreaterThan(CODE_TASK_TTL_MS - 60_000);
    expect(ttl).toBeLessThanOrEqual(CODE_TASK_TTL_MS);
    expect(await podB.get("test-unknown")).toBeNull();
  });

  test("only one pod passes the gate, and the next passes after the gap or a release", async () => {
    const gate = newId("mcp:code-check:");
    expect(await podA.claimCheck(gate, now, 0)).toBe(true);
    expect(await podA.claimCheck(gate, now + 44_000, 45_000)).toBe(false);
    const taken = await Promise.all([
      podA.claimCheck(gate, now + 60_000, 45_000),
      podB.claimCheck(gate, now + 60_000, 45_000),
    ]);
    expect(taken.filter(Boolean)).toHaveLength(1);
    expect(await podB.claimCheck(gate, now + 90_000, 45_000)).toBe(false);
    await podA.releaseCheck(gate);
    expect(await podB.claimCheck(gate, now + 90_000, 45_000)).toBe(true);
  });

  test("the first final status wins", async () => {
    const id = newId("mcp:code-task:");
    const task = record({ createdAt: now });
    await podA.put(id, task);
    expect(await podA.put(id, { ...task, status: "cancelled" })).toBe(true);
    expect(await podB.put(id, { ...task, status: "completed", result: { content: [] } })).toBe(
      false
    );
    expect((await podA.get(id))?.status).toBe("cancelled");
  });
});
