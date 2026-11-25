import {
  McpServer,
  PROTOCOL_VERSION_META_KEY,
  ProtocolError,
  createMcpHandler,
} from "@modelcontextprotocol/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  CODE_TASK_TTL_MS,
  CODE_TASK_WAIT_MS,
  MAX_TASK_ID_LENGTH,
  MemoryCodeTaskStore,
  TASKS_EXTENSION,
  callerBinding,
  clientDeclaresTasks,
  codeTaskStore,
  createCodeTask,
  findCodeTask,
  pollSeconds,
  resetCodeTasks,
  type CodeTaskView,
} from "../src/lib/code-task.js";
import { cancelCodeTask, getCodeTask, registerCodeTools } from "../src/lib/code-tools.js";
import type { ClientContext, CodeRequest } from "../src/lib/types.js";

const REQUEST: CodeRequest = { libraryId: "/honojs/hono", version: "v4.7.0", pattern: "serve" };
const INDEXING = { retryAfter: 30, message: "The source of /honojs/hono is being indexed." };
const CALLER: ClientContext = { transport: "stdio", apiKey: "ctx7sk-one" };
const T0 = 1_800_000_000_000;
const RESULT_TEXT = 'Library: /honojs/hono at v4.7.0\n2 matching lines in 1 files for "serve"';

/** An unsigned JWT: the binding reads `sub` without checking the signature. */
function jwt(sub: string, jti: string): string {
  const part = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${part({ alg: "none" })}.${part({ sub, jti })}.sig`;
}

function indexing202(retryAfter = 30, message = INDEXING.message): Response {
  return Response.json({ status: "preparing", retryAfter, message }, { status: 202 });
}

let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

beforeEach(() => {
  resetCodeTasks();
  fetchMock = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function newTask(context = CALLER, retryAfter = 30): Promise<CodeTaskView> {
  const task = await createCodeTask("grep-code", REQUEST, { ...INDEXING, retryAfter }, context, T0);
  if (!task) throw new Error("no task");
  return task;
}

describe("clientDeclaresTasks", () => {
  const envelope = (capabilities: unknown) => ({
    "io.modelcontextprotocol/clientCapabilities": capabilities,
  });

  test("is true only when the request declares the extension", () => {
    expect(clientDeclaresTasks(envelope({ extensions: { [TASKS_EXTENSION]: {} } }))).toBe(true);
    expect(
      clientDeclaresTasks(envelope({ extensions: { "io.modelcontextprotocol/ui": {} } }))
    ).toBe(false);
    expect(clientDeclaresTasks(envelope({ elicitation: {} }))).toBe(false);
    expect(clientDeclaresTasks(envelope(undefined))).toBe(false);
    expect(clientDeclaresTasks(undefined)).toBe(false);
  });
});

describe("task", () => {
  test("is stored before the answer, with an ID that clients accept", async () => {
    const task = await newTask();
    expect(task).toMatchObject({ status: "working", ttlMs: CODE_TASK_TTL_MS });
    expect(task.statusMessage).toContain(INDEXING.message);
    expect(task.taskId).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(task.taskId.length).toBeLessThanOrEqual(MAX_TASK_ID_LENGTH);
    expect((await findCodeTask(task.taskId, CALLER))?.record).toMatchObject({
      tool: "grep-code",
      request: REQUEST,
      createdAt: T0,
    });
  });

  test("is not found with another credential, without one, or with an unknown ID", async () => {
    const { taskId } = await newTask();
    expect(await findCodeTask(taskId, { transport: "stdio", apiKey: "ctx7sk-two" })).toBeNull();
    expect(await findCodeTask(taskId, { transport: "stdio" })).toBeNull();
    expect(await findCodeTask("unknown", CALLER)).toBeNull();
    expect(await findCodeTask("x".repeat(MAX_TASK_ID_LENGTH + 1), CALLER)).toBeNull();
  });

  test("stays readable when an OAuth token is refreshed, and closed for another user", async () => {
    const first = { transport: "stdio", apiKey: jwt("user_1", "a") } as const;
    const { taskId } = await newTask(first);
    const refreshed = { transport: "stdio", apiKey: jwt("user_1", "b") } as const;
    expect(await findCodeTask(taskId, refreshed)).not.toBeNull();
    expect(
      await findCodeTask(taskId, { transport: "stdio", apiKey: jwt("user_2", "a") })
    ).toBeNull();
    expect(callerBinding(first)).not.toContain("user_1");
  });

  test("an anonymous task is readable for an anonymous caller only", async () => {
    const { taskId } = await newTask({ transport: "stdio" });
    expect(await findCodeTask(taskId, { transport: "stdio" })).not.toBeNull();
    expect(await findCodeTask(taskId, CALLER)).toBeNull();
  });

  test("the hosted server has no shared store yet, so it creates no task", async () => {
    expect(codeTaskStore("http")).toBeNull();
    const hosted: ClientContext = { transport: "http", apiKey: "ctx7sk-one" };
    expect(await createCodeTask("grep-code", REQUEST, INDEXING, hosted, T0)).toBeNull();
  });
});

describe("MemoryCodeTaskStore", () => {
  const record = (createdAt: number) => ({
    tool: "grep-code" as const,
    request: REQUEST,
    createdAt,
    updatedAt: createdAt,
    caller: "anon",
    pollSeconds: 30,
    lastCheckAt: createdAt,
    status: "working" as const,
    message: "m",
  });

  test("drops a task one hour after its creation", async () => {
    const store = new MemoryCodeTaskStore();
    await store.put("a", record(T0));
    expect(await store.get("a", T0 + CODE_TASK_TTL_MS - 1)).not.toBeNull();
    expect(await store.get("a", T0 + CODE_TASK_TTL_MS)).toBeNull();
  });

  test("keeps the newest tasks when it is full", async () => {
    const store = new MemoryCodeTaskStore(2);
    for (const id of ["a", "b", "c"]) await store.put(id, record(T0));
    expect(await store.get("a", T0)).toBeNull();
    expect(await store.get("c", T0)).not.toBeNull();
  });

  test("claims a check only when the last one is old enough", async () => {
    const store = new MemoryCodeTaskStore();
    await store.put("a", record(T0));
    expect(await store.claimCheck("a", T0 + 44_000, 45_000)).toBe(false);
    expect(await store.claimCheck("a", T0 + 45_000, 45_000)).toBe(true);
    expect(await store.claimCheck("a", T0 + 60_000, 45_000)).toBe(false);
    expect(await store.claimCheck("unknown", T0, 0)).toBe(false);
  });
});

describe("poll interval", () => {
  test("is never below retryAfter, and at least 30 seconds", async () => {
    for (const retryAfter of [1, 5, 29.2, 30, 31, 45.5, 60, 120]) {
      expect(pollSeconds(retryAfter)).toBeGreaterThanOrEqual(retryAfter);
      expect(pollSeconds(retryAfter)).toBeGreaterThanOrEqual(30);
      const task = await newTask(CALLER, retryAfter);
      expect(task.pollIntervalMs).toBeGreaterThanOrEqual(retryAfter * 1000);
    }
  });

  test("a client that polls every 30 seconds causes 10 API requests in 10 minutes", async () => {
    fetchMock.mockImplementation(async () => indexing202());
    const { taskId } = await newTask();
    const times: number[] = [];
    for (let poll = 1; poll <= 20; poll++) {
      const before = fetchMock.mock.calls.length;
      await getCodeTask(taskId, CALLER, T0 + poll * 30_000);
      if (fetchMock.mock.calls.length > before) times.push(poll * 30);
    }
    expect(times).toHaveLength(10);
    // Never closer than retryAfter (30 s), counted from the tool call at 0.
    expect(times[0]).toBe(60);
    for (let i = 1; i < times.length; i++) expect(times[i]! - times[i - 1]!).toBe(60);
  });

  test("a longer retryAfter is the gap between API requests", async () => {
    fetchMock.mockImplementation(async () => indexing202(120));
    const { taskId } = await newTask(CALLER, 120);
    for (const seconds of [30, 60, 90, 119]) await getCodeTask(taskId, CALLER, T0 + seconds * 1000);
    expect(fetchMock).not.toHaveBeenCalled();
    await getCodeTask(taskId, CALLER, T0 + 120_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("getCodeTask", () => {
  const due = T0 + 60_000;

  test("answers working without a request to the API before the gap has passed", async () => {
    const { taskId } = await newTask();
    const view = await getCodeTask(taskId, CALLER, T0 + 30_000);
    expect(view).toMatchObject({ taskId, status: "working", pollIntervalMs: 30_000 });
    expect(view.statusMessage).toContain(INDEXING.message);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("answers working with the API's new message while the API answers 202", async () => {
    fetchMock.mockResolvedValue(indexing202(30, "Indexing, about 2 minutes left."));
    const view = await getCodeTask((await newTask()).taskId, CALLER, due);
    expect(view.status).toBe("working");
    expect(view.statusMessage).toContain("Indexing, about 2 minutes left.");
    expect(view.result).toBeUndefined();
  });

  test("asks the API with the request of the task and the credential of the tasks/get call", async () => {
    fetchMock.mockResolvedValue(indexing202());
    const refreshed = { transport: "stdio", apiKey: jwt("user_1", "b") } as const;
    const { taskId } = await newTask({ transport: "stdio", apiKey: jwt("user_1", "a") });
    await getCodeTask(taskId, refreshed, due);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain("libraryId=%2Fhonojs%2Fhono");
    expect(String(url)).toContain("pattern=serve");
    expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${refreshed.apiKey}`);
  });

  test("completes with the result the tool returns, and keeps it", async () => {
    fetchMock.mockResolvedValue(new Response(RESULT_TEXT));
    const { taskId } = await newTask();
    const view = await getCodeTask(taskId, CALLER, due);
    expect(view.status).toBe("completed");
    expect(view.result).toEqual({ content: [{ type: "text", text: RESULT_TEXT }] });
    expect(view.error).toBeUndefined();
    // A later read, for example after a resume, costs no request.
    expect(await getCodeTask(taskId, CALLER, due + 600_000)).toMatchObject({
      status: "completed",
      result: view.result,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("completes with the tool's error result when the API refuses the request", async () => {
    fetchMock.mockResolvedValue(
      Response.json({ error: "index_failed", message: "The tag does not exist." }, { status: 404 })
    );
    const view = await getCodeTask((await newTask()).taskId, CALLER, due);
    expect(view.status).toBe("completed");
    expect(view.result).toMatchObject({ isError: true });
  });

  test("fails after the 30 minute wait when the index is still not ready", async () => {
    fetchMock.mockResolvedValue(indexing202());
    const { taskId } = await newTask();
    const view = await getCodeTask(taskId, CALLER, T0 + CODE_TASK_WAIT_MS);
    expect(view.status).toBe("failed");
    expect(view.error?.message).toContain("Call grep-code again");
    expect(await getCodeTask(taskId, CALLER, T0 + CODE_TASK_WAIT_MS + 60_000)).toMatchObject({
      status: "failed",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("still completes after the 30 minute wait when the index is ready", async () => {
    fetchMock.mockResolvedValue(new Response(RESULT_TEXT));
    const view = await getCodeTask((await newTask()).taskId, CALLER, T0 + CODE_TASK_WAIT_MS);
    expect(view.status).toBe("completed");
  });

  test("an expired task is unknown", async () => {
    const { taskId } = await newTask();
    vi.useFakeTimers({ now: T0 + CODE_TASK_TTL_MS });
    try {
      await expect(getCodeTask(taskId, CALLER)).rejects.toThrow("Unknown task");
    } finally {
      vi.useRealTimers();
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("rejects another caller and an unknown ID with the same error", async () => {
    const { taskId } = await newTask();
    const other: ClientContext = { transport: "stdio", apiKey: "ctx7sk-two" };
    await expect(getCodeTask(taskId, other, due)).rejects.toThrow(ProtocolError);
    await expect(getCodeTask(taskId, other, due)).rejects.toThrow("Unknown task");
    await expect(getCodeTask("unknown", CALLER, due)).rejects.toThrow("Unknown task");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("a cancelled task stays cancelled and asks the API no more", async () => {
    const { taskId } = await newTask();
    await cancelCodeTask(taskId, { transport: "stdio", apiKey: "ctx7sk-two" }, due);
    expect((await getCodeTask(taskId, CALLER, T0 + 1_000)).status).toBe("working");
    await cancelCodeTask(taskId, CALLER, due);
    await cancelCodeTask("unknown", CALLER, due);
    expect((await getCodeTask(taskId, CALLER, due + 60_000)).status).toBe("cancelled");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("over MCP", () => {
  const handler = createMcpHandler(
    () => {
      const server = new McpServer(
        { name: "test", version: "1.0.0" },
        { capabilities: { tools: {}, extensions: { [TASKS_EXTENSION]: {} } } }
      );
      registerCodeTools(server, () => CALLER);
      return server;
    },
    { keepAliveMs: 0, onerror: () => undefined }
  );

  async function rpc(
    method: string,
    params: Record<string, unknown>,
    options: { name?: string; tasks?: boolean } = {}
  ) {
    const response = await handler.fetch(
      new Request("http://127.0.0.1/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          "mcp-protocol-version": "2026-07-28",
          "mcp-method": method,
          ...(options.name ? { "mcp-name": options.name } : {}),
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method,
          params: {
            ...params,
            _meta: {
              [PROTOCOL_VERSION_META_KEY]: "2026-07-28",
              "io.modelcontextprotocol/clientInfo": { name: "test", version: "1" },
              "io.modelcontextprotocol/clientCapabilities": options.tasks
                ? { extensions: { [TASKS_EXTENSION]: {} } }
                : {},
            },
          },
        }),
      })
    );
    return (await response.json()) as {
      result?: Record<string, unknown>;
      error?: { code: number; message: string };
    };
  }

  const grep = (tasks: boolean) =>
    rpc(
      "tools/call",
      { name: "grep-code", arguments: { libraryId: "/honojs/hono", pattern: "serve" } },
      { name: "grep-code", tasks }
    );

  test("a 202 stays a text answer for a client that did not declare tasks", async () => {
    fetchMock.mockResolvedValue(indexing202());
    const { result } = await grep(false);
    expect(result?.resultType).toBe("complete");
    expect(result?.taskId).toBeUndefined();
    expect(JSON.stringify(result?.content)).toContain("answer from query-docs now");
  });

  test("a 202 becomes a task for a client that declared tasks", async () => {
    fetchMock.mockResolvedValue(indexing202(45));
    const { result } = await grep(true);
    expect(result).toMatchObject({ resultType: "task", status: "working", pollIntervalMs: 45_000 });
    expect(result?.ttlMs).toBe(CODE_TASK_TTL_MS);
    const found = await findCodeTask(String(result?.taskId), CALLER);
    expect(found?.record).toMatchObject({ tool: "grep-code", status: "working" });
  });

  test("any other answer stays synchronous for a client that declared tasks", async () => {
    fetchMock.mockResolvedValue(new Response(RESULT_TEXT));
    const { result } = await grep(true);
    expect(result?.resultType).toBe("complete");
    expect(result?.content).toEqual([{ type: "text", text: RESULT_TEXT }]);
  });

  test("serves tasks/get, tasks/update and tasks/cancel", async () => {
    fetchMock.mockResolvedValue(indexing202());
    const taskId = String((await grep(true)).result?.taskId);

    const got = await rpc("tasks/get", { taskId }, { name: taskId, tasks: true });
    expect(got.result).toMatchObject({ taskId, status: "working" });
    for (const method of ["tasks/update", "tasks/cancel"]) {
      const answer = await rpc(method, { taskId }, { name: taskId, tasks: true });
      expect(answer.error).toBeUndefined();
      expect(answer.result?.taskId).toBeUndefined();
    }
    const cancelled = await rpc("tasks/get", { taskId }, { name: taskId, tasks: true });
    expect(cancelled.result).toMatchObject({ taskId, status: "cancelled" });

    const unknown = await rpc("tasks/get", { taskId: "abc" }, { name: "abc", tasks: true });
    expect(unknown.error).toMatchObject({ code: -32602, message: "Unknown task" });
  });
});
