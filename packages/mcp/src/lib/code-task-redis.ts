import { Redis } from "@upstash/redis";
import { CODE_TASK_TTL_MS, type CodeTaskRecord, type CodeTaskStore } from "./code-task.js";

// The task store of the hosted server: every pod reads and writes the same Upstash Redis
// database, so a tasks/get can reach any pod. Every command is a script, so it runs on the primary:
// a read replica could miss a task that another pod has just written.
//   mcp:code-task:<taskId>  hash: `record` (the CodeTaskRecord as JSON) and `status` (its status,
//                           for the scripts); expires CODE_TASK_TTL_MS after the task's creation
//   mcp:code-check:<gate>   time of the last API request through the gate, Unix milliseconds

/** The part of the Redis client the store uses. */
export interface TaskRedis {
  eval(script: string, keys: string[], args: string[]): Promise<unknown>;
}

const TASK_PREFIX = "mcp:code-task:";
const GATE_PREFIX = "mcp:code-check:";

const GET_SCRIPT = `return redis.call("HGET", KEYS[1], "record")`;

/** Writes the task unless it has ended: the first final status wins. */
const PUT_SCRIPT = `
local status = redis.call("HGET", KEYS[1], "status")
if status and status ~= "working" then return 0 end
redis.call("HSET", KEYS[1], "record", ARGV[1], "status", ARGV[2])
redis.call("PEXPIREAT", KEYS[1], ARGV[3])
return 1
`;

/** Takes the gate when its last request is at least ARGV[2] milliseconds old. */
const CLAIM_SCRIPT = `
local last = redis.call("GET", KEYS[1])
if last and tonumber(ARGV[1]) - tonumber(last) < tonumber(ARGV[2]) then return 0 end
redis.call("SET", KEYS[1], ARGV[1], "PX", ARGV[3])
return 1
`;

const RELEASE_SCRIPT = `return redis.call("DEL", KEYS[1])`;

export class RedisCodeTaskStore implements CodeTaskStore {
  constructor(private readonly redis: TaskRedis) {}

  async get(taskId: string): Promise<CodeTaskRecord | null> {
    const value = await this.redis.eval(GET_SCRIPT, [TASK_PREFIX + taskId], []);
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

  async put(taskId: string, record: CodeTaskRecord): Promise<boolean> {
    const written = await this.redis.eval(
      PUT_SCRIPT,
      [TASK_PREFIX + taskId],
      [JSON.stringify(record), record.status, String(record.createdAt + CODE_TASK_TTL_MS)]
    );
    return Number(written) === 1;
  }

  async claimCheck(gate: string, nowMs: number, gapMs: number): Promise<boolean> {
    const taken = await this.redis.eval(
      CLAIM_SCRIPT,
      [GATE_PREFIX + gate],
      [String(nowMs), String(gapMs), String(CODE_TASK_TTL_MS)]
    );
    return Number(taken) === 1;
  }

  async releaseCheck(gate: string): Promise<void> {
    await this.redis.eval(RELEASE_SCRIPT, [GATE_PREFIX + gate], []);
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
