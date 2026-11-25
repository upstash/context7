import { Redis } from "@upstash/redis";
import { CODE_TASK_TTL_MS, type CodeTaskRecord, type CodeTaskStore } from "./code-task.js";

// The task store of the hosted server: every pod reads and writes the same Upstash Redis
// database, so a tasks/get can reach any pod. A task is one hash, `mcp:code-task:<taskId>`:
//   record  the CodeTaskRecord as JSON
//   status  the record's status, for the scripts
//   check   the time of the last request to the API for the task, Unix milliseconds
// The hash expires CODE_TASK_TTL_MS after the task's creation.

/** The part of the Redis client the store uses. */
export interface TaskRedis {
  hget(key: string, field: string): Promise<unknown>;
  eval(script: string, keys: string[], args: string[]): Promise<unknown>;
}

const KEY_PREFIX = "mcp:code-task:";

/** Writes the task unless it has ended: the first final status wins. */
export const PUT_SCRIPT = `
local status = redis.call("HGET", KEYS[1], "status")
if status and status ~= "working" then return 0 end
redis.call("HSET", KEYS[1], "record", ARGV[1], "status", ARGV[2], "check", ARGV[3])
redis.call("PEXPIREAT", KEYS[1], ARGV[4])
return 1
`;

/** Takes the next request to the API for a working task when the last one is old enough. */
export const CLAIM_SCRIPT = `
local last = redis.call("HGET", KEYS[1], "check")
if not last then return 0 end
if redis.call("HGET", KEYS[1], "status") ~= "working" then return 0 end
if tonumber(ARGV[1]) - tonumber(last) < tonumber(ARGV[2]) then return 0 end
redis.call("HSET", KEYS[1], "check", ARGV[1])
return 1
`;

export class RedisCodeTaskStore implements CodeTaskStore {
  constructor(private readonly redis: TaskRedis) {}

  async get(taskId: string): Promise<CodeTaskRecord | null> {
    const value = await this.redis.hget(KEY_PREFIX + taskId, "record");
    if (typeof value !== "string") return null;
    try {
      const record = JSON.parse(value) as CodeTaskRecord;
      return record && typeof record === "object" && typeof record.caller === "string"
        ? record
        : null;
    } catch {
      return null;
    }
  }

  async put(taskId: string, record: CodeTaskRecord): Promise<void> {
    await this.redis.eval(
      PUT_SCRIPT,
      [KEY_PREFIX + taskId],
      [
        JSON.stringify(record),
        record.status,
        String(record.lastCheckAt),
        String(record.createdAt + CODE_TASK_TTL_MS),
      ]
    );
  }

  async claimCheck(taskId: string, nowMs: number, gapMs: number): Promise<boolean> {
    const taken = await this.redis.eval(
      CLAIM_SCRIPT,
      [KEY_PREFIX + taskId],
      [String(nowMs), String(gapMs)]
    );
    return Number(taken) === 1;
  }
}

/**
 * The store for the database in UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN, or null
 * when one of them is not set.
 */
export function redisCodeTaskStoreFromEnv(): RedisCodeTaskStore | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return new RedisCodeTaskStore(
    new Redis({
      url,
      token,
      // The store reads and writes JSON text itself.
      automaticDeserialization: false,
      // A tool call or a poll waits for these: two short tries, not the client's five.
      retry: { retries: 1, backoff: () => 100 },
    })
  );
}
