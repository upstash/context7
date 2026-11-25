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
  MemoryCodeTaskStore,
  TASKS_EXTENSION,
  callerBinding,
  checkGate,
  clientDeclaresTasks,
  createCodeTask,
  findCodeTask,
  pollSeconds,
  type CodeTaskStore,
  type CodeTaskView,
} from "../src/lib/code-task.js";
import { cancelCodeTask, getCodeTask, registerCodeTools } from "../src/lib/code-tools.js";
import type { ClientContext, CodeRequest } from "../src/lib/types.js";

const REQUEST: CodeRequest = { libraryId: "/honojs/hono", version: "v4.7.0", pattern: "serve" };
const INDEXING = { retryAfter: 30, message: "The source of /honojs/hono is being indexed." };
const CALLER: ClientContext = { transport: "http", apiKey: "ctx7sk-one" };
const T0 = 1_800_000_000_000;
const RESULT_TEXT = 'Library: /honojs/hono at v4.7.0\n2 matching lines in 1 files for "serve"';
const MODERN = { [PROTOCOL_VERSION_META_KEY]: "2026-07-28" };

/** An unsigned JWT: the binding reads `sub` without checking the signature. */
function jwt(sub: string, jti: string): string {
  const part = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${part({ alg: "none" })}.${part({ sub, jti })}.sig`;
}

function indexing202(retryAfter = 30, message = INDEXING.message): Response {
  return Response.json({ error: "indexing", retryAfter, message }, { status: 202 });
}

let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
let store: MemoryCodeTaskStore;

beforeEach(() => {
  store = new MemoryCodeTaskStore();
  fetchMock = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function newTask(
  context = CALLER,
  request = REQUEST,
  retryAfter: number | undefined = 30
): Promise<CodeTaskView> {
  const task = await createCodeTask(
    store,
    "grep-code",
    request,
    { ...INDEXING, retryAfter },
    context,
    T0
  );
  if (!task) throw new Error("no task");
  return task;
}

const poll = (taskId: string, seconds: number, context = CALLER) =>
  getCodeTask(store, taskId, context, T0 + seconds * 1000);

describe("clientDeclaresTasks", () => {
  const envelope = (capabilities: unknown, meta: object = MODERN) => ({
    ...meta,
    "io.modelcontextprotocol/clientCapabilities": capabilities,
  });
  const tasks = { extensions: { [TASKS_EXTENSION]: {} } };

  test("is true only for a 2026-07-28 request that declares the extension", () => {
    expect(clientDeclaresTasks(envelope(tasks))).toBe(true);
    expect(
      clientDeclaresTasks(envelope({ extensions: { "io.modelcontextprotocol/ui": {} } }))
    ).toBe(false);
    expect(clientDeclaresTasks(envelope({ elicitation: {} }))).toBe(false);
    expect(clientDeclaresTasks(envelope(undefined))).toBe(false);
    expect(clientDeclaresTasks(undefined)).toBe(false);
  });

  test("is false for a 2025-era request, whatever its _meta holds", () => {
    expect(clientDeclaresTasks(envelope(tasks, {}))).toBe(false);
    expect(
      clientDeclaresTasks(envelope(tasks, { [PROTOCOL_VERSION_META_KEY]: "2025-11-25" }))
    ).toBe(false);
  });
});

describe("task", () => {
  test("is stored before the answer, with a short random ID", async () => {
    const task = await newTask();
    expect(task).toMatchObject({ status: "working", ttlMs: CODE_TASK_TTL_MS });
    expect(task.statusMessage).toContain(INDEXING.message);
    expect(task.taskId).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(await findCodeTask(store, task.taskId, CALLER, T0)).toMatchObject({
      tool: "grep-code",
      request: REQUEST,
      createdAt: T0,
    });
  });

  test("keeps the result for an hour after the 30 minute wait", () => {
    expect(CODE_TASK_TTL_MS).toBe(CODE_TASK_WAIT_MS + 60 * 60 * 1000);
  });

  test("is not found with another credential, without one, or with an unknown ID", async () => {
    const { taskId } = await newTask();
    expect(await findCodeTask(store, taskId, { apiKey: "ctx7sk-two" }, T0)).toBeNull();
    expect(await findCodeTask(store, taskId, {}, T0)).toBeNull();
    expect(await findCodeTask(store, "unknown", CALLER, T0)).toBeNull();
  });

  test("stays readable when an OAuth token is refreshed, and closed for another user", async () => {
    const { taskId } = await newTask({ apiKey: jwt("user_1", "a") });
    expect(await findCodeTask(store, taskId, { apiKey: jwt("user_1", "b") }, T0)).not.toBeNull();
    expect(await findCodeTask(store, taskId, { apiKey: jwt("user_2", "a") }, T0)).toBeNull();
    expect(callerBinding({ apiKey: jwt("user_1", "a") })).not.toContain("user_1");
  });

  test("an anonymous task is readable for an anonymous caller only", async () => {
    const { taskId } = await newTask({});
    expect(await findCodeTask(store, taskId, { clientIp: "203.0.113.9" }, T0)).not.toBeNull();
    expect(await findCodeTask(store, taskId, CALLER, T0)).toBeNull();
  });

  test("is gone one hour after the wait", async () => {
    const { taskId } = await newTask();
    expect(await findCodeTask(store, taskId, CALLER, T0 + CODE_TASK_TTL_MS - 1)).not.toBeNull();
    expect(await findCodeTask(store, taskId, CALLER, T0 + CODE_TASK_TTL_MS)).toBeNull();
  });

  test("is not created when the store fails, so the tool answers without one", async () => {
    const failing: CodeTaskStore = {
      get: async () => null,
      put: async () => {
        throw new Error("redis down");
      },
      claimCheck: async () => false,
      releaseCheck: async () => undefined,
    };
    expect(await createCodeTask(failing, "grep-code", REQUEST, INDEXING, CALLER, T0)).toBeNull();
    expect(console.error).toHaveBeenCalled();
  });
});

describe("MemoryCodeTaskStore", () => {
  const record = {
    tool: "grep-code" as const,
    request: REQUEST,
    createdAt: T0,
    updatedAt: T0,
    caller: "anon",
    pollSeconds: 30,
    status: "working" as const,
    message: "m",
  };

  test("keeps the newest tasks when it is full", async () => {
    const small = new MemoryCodeTaskStore(2);
    for (const id of ["a", "b", "c"]) await small.put(id, record);
    expect(await small.get("a", T0)).toBeNull();
    expect(await small.get("c", T0)).not.toBeNull();
  });

  test("does not write a task again after it has ended", async () => {
    expect(await store.put("a", { ...record, status: "cancelled" })).toBe(true);
    expect(await store.put("a", { ...record, status: "completed", result: {} })).toBe(false);
    expect((await store.get("a", T0))?.status).toBe("cancelled");
  });

  test("lets a request through the gate only after the gap or a release", async () => {
    expect(await store.claimCheck("g", T0, 0)).toBe(true);
    expect(await store.claimCheck("g", T0 + 44_000, 45_000)).toBe(false);
    expect(await store.claimCheck("g", T0 + 45_000, 45_000)).toBe(true);
    await store.releaseCheck("g");
    expect(await store.claimCheck("g", T0 + 46_000, 45_000)).toBe(true);
  });
});

describe("poll interval", () => {
  test("is never below retryAfter, and at least 30 seconds", async () => {
    for (const retryAfter of [undefined, 1, 5, 29.2, 30, 31, 45.5, 60, 120]) {
      expect(pollSeconds(retryAfter)).toBeGreaterThanOrEqual(retryAfter ?? 0);
      expect(pollSeconds(retryAfter)).toBeGreaterThanOrEqual(30);
      const task = await newTask(CALLER, REQUEST, retryAfter);
      expect(task.pollIntervalMs).toBeGreaterThanOrEqual((retryAfter ?? 0) * 1000);
    }
  });

  test("a client that polls every 30 seconds causes 10 API requests in 10 minutes", async () => {
    fetchMock.mockImplementation(async () => indexing202());
    const { taskId } = await newTask();
    const times: number[] = [];
    for (let seconds = 30; seconds <= 600; seconds += 30) {
      const before = fetchMock.mock.calls.length;
      await poll(taskId, seconds);
      if (fetchMock.mock.calls.length > before) times.push(seconds);
    }
    expect(times).toHaveLength(10);
    // Never closer than retryAfter (30 s), counted from the tool call at 0.
    expect(times[0]).toBe(60);
    for (let i = 1; i < times.length; i++) expect(times[i]! - times[i - 1]!).toBe(60);
  });

  test("parallel tasks for one version share the requests", async () => {
    fetchMock.mockImplementation(async () => indexing202());
    const grep = await newTask();
    const glob = await newTask(CALLER, { libraryId: "/HonoJS/hono", version: "v4.7.0" });
    expect(checkGate({ caller: "x", request: REQUEST })).toBe(
      checkGate({ caller: "x", request: { libraryId: "/honojs/hono ", version: "v4.7.0" } })
    );
    for (let seconds = 30; seconds <= 600; seconds += 30) {
      await poll(grep.taskId, seconds);
      await poll(glob.taskId, seconds);
    }
    expect(fetchMock).toHaveBeenCalledTimes(10);
  });

  test("another version, or another caller, has its own requests", async () => {
    fetchMock.mockImplementation(async () => indexing202());
    const a = await newTask();
    const b = await newTask(CALLER, { ...REQUEST, version: "v4.8.0" });
    const c = await newTask({ apiKey: "ctx7sk-two" });
    await poll(a.taskId, 60);
    await poll(b.taskId, 60);
    await poll(c.taskId, 60, { apiKey: "ctx7sk-two" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  test("a later, longer retryAfter is the gap between API requests", async () => {
    fetchMock.mockImplementation(async () => indexing202(120));
    const { taskId } = await newTask();
    expect((await poll(taskId, 60)).pollIntervalMs).toBe(120_000);
    for (const seconds of [90, 120, 150, 179]) await poll(taskId, seconds);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await poll(taskId, 180);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("getCodeTask", () => {
  test("answers working without a request to the API before the gap has passed", async () => {
    const { taskId } = await newTask();
    const view = await poll(taskId, 30);
    expect(view).toMatchObject({ taskId, status: "working", pollIntervalMs: 30_000 });
    expect(view.statusMessage).toContain(INDEXING.message);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("answers working with the API's new message while the API answers 202", async () => {
    fetchMock.mockResolvedValue(indexing202(30, "Indexing, about 2 minutes left."));
    const view = await poll((await newTask()).taskId, 60);
    expect(view.status).toBe("working");
    expect(view.statusMessage).toContain("Indexing, about 2 minutes left.");
    expect(view.result).toBeUndefined();
  });

  test("asks the API with the request of the task and the credential of the poll", async () => {
    fetchMock.mockResolvedValue(indexing202());
    const refreshed = { apiKey: jwt("user_1", "b") };
    const { taskId } = await newTask({ apiKey: jwt("user_1", "a") });
    await poll(taskId, 60, refreshed);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain("libraryId=%2Fhonojs%2Fhono");
    expect(String(url)).toContain("pattern=serve");
    expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${refreshed.apiKey}`);
  });

  test("completes with the result the tool returns, and keeps it", async () => {
    fetchMock.mockResolvedValue(new Response(RESULT_TEXT));
    const { taskId } = await newTask();
    const view = await poll(taskId, 60);
    expect(view.status).toBe("completed");
    expect(view.result).toEqual({ content: [{ type: "text", text: RESULT_TEXT }] });
    // A later read, for example after a resume, costs no request.
    expect(await poll(taskId, 1200)).toMatchObject({ status: "completed", result: view.result });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("a ready index lets the other tasks of the version ask at their next poll", async () => {
    fetchMock.mockImplementation(async () => new Response(RESULT_TEXT));
    const grep = await newTask();
    const glob = await newTask(CALLER, { libraryId: "/honojs/hono", version: "v4.7.0" });
    expect((await poll(grep.taskId, 60)).status).toBe("completed");
    expect((await poll(glob.taskId, 61)).status).toBe("completed");
  });

  test("completes with the tool's error result when the API refuses the request", async () => {
    fetchMock.mockResolvedValue(
      Response.json({ error: "index_failed", message: "The tag does not exist." }, { status: 404 })
    );
    const view = await poll((await newTask()).taskId, 60);
    expect(view.status).toBe("completed");
    expect(view.result).toMatchObject({ isError: true });
  });

  test("waits on after a timeout or a gateway error", async () => {
    const { taskId } = await newTask();
    fetchMock.mockRejectedValueOnce(new Error("timeout"));
    expect((await poll(taskId, 60)).status).toBe("working");
    fetchMock.mockResolvedValueOnce(new Response("Bad gateway", { status: 502 }));
    expect((await poll(taskId, 120)).status).toBe("working");
    fetchMock.mockResolvedValueOnce(new Response(RESULT_TEXT));
    expect((await poll(taskId, 180)).status).toBe("completed");
  });

  test("ends after the 30 minute wait even when the API keeps timing out", async () => {
    fetchMock.mockRejectedValue(new Error("timeout"));
    const view = await poll((await newTask()).taskId, CODE_TASK_WAIT_MS / 1000);
    expect(view.status).toBe("completed");
    expect(view.result).toMatchObject({ isError: true });
  });

  test("ends after the 30 minute wait with the answer the call gives without a task", async () => {
    fetchMock.mockResolvedValue(indexing202());
    const { taskId } = await newTask();
    const view = await poll(taskId, CODE_TASK_WAIT_MS / 1000);
    expect(view.status).toBe("completed");
    expect(JSON.stringify(view.result)).toContain("answer from query-docs now");
    expect(view.result).not.toHaveProperty("isError");
  });

  test("still completes after the 30 minute wait when the index is ready", async () => {
    fetchMock.mockResolvedValue(new Response(RESULT_TEXT));
    const view = await poll((await newTask()).taskId, CODE_TASK_WAIT_MS / 1000);
    expect(view.result).toEqual({ content: [{ type: "text", text: RESULT_TEXT }] });
  });

  test("rejects another caller and an unknown ID with the same error", async () => {
    const { taskId } = await newTask();
    const other = { apiKey: "ctx7sk-two" };
    await expect(poll(taskId, 60, other)).rejects.toThrow(ProtocolError);
    await expect(poll(taskId, 60, other)).rejects.toThrow("Unknown task");
    await expect(poll("unknown", 60)).rejects.toThrow("Unknown task");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("answers the stored state when a cancel wins during the API request", async () => {
    const { taskId } = await newTask();
    fetchMock.mockImplementation(async () => {
      await cancelCodeTask(store, taskId, CALLER, T0 + 61_000);
      return new Response(RESULT_TEXT);
    });
    expect((await poll(taskId, 60)).status).toBe("cancelled");
  });
});

describe("cancelCodeTask", () => {
  test("ends a working task, and changes nothing after that", async () => {
    const { taskId } = await newTask();
    await cancelCodeTask(store, taskId, CALLER, T0 + 1_000);
    await cancelCodeTask(store, taskId, CALLER, T0 + 2_000);
    expect((await poll(taskId, 60)).status).toBe("cancelled");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("rejects another caller and an unknown ID", async () => {
    const { taskId } = await newTask();
    await expect(cancelCodeTask(store, taskId, { apiKey: "ctx7sk-two" })).rejects.toThrow(
      "Unknown task"
    );
    await expect(cancelCodeTask(store, "unknown", CALLER)).rejects.toThrow("Unknown task");
    expect((await poll(taskId, 30)).status).toBe("working");
  });
});

describe("over MCP", () => {
  function handler(taskStore: CodeTaskStore | null) {
    return createMcpHandler(
      () => {
        const server = new McpServer(
          { name: "test", version: "1.0.0" },
          { capabilities: { tools: {}, extensions: { [TASKS_EXTENSION]: {} } } }
        );
        registerCodeTools(server, () => CALLER, taskStore);
        return server;
      },
      { keepAliveMs: 0, onerror: () => undefined }
    );
  }

  async function rpc(
    taskStore: CodeTaskStore | null,
    method: string,
    params: Record<string, unknown>,
    options: { name?: string; tasks?: boolean } = {}
  ) {
    const response = await handler(taskStore).fetch(
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
              ...MODERN,
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

  const grep = (tasks: boolean, taskStore: CodeTaskStore | null = store) =>
    rpc(
      taskStore,
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

  test("a 202 stays a text answer on a server without a task store", async () => {
    fetchMock.mockResolvedValue(indexing202());
    const { result } = await grep(true, null);
    expect(result?.resultType).toBe("complete");
    expect(JSON.stringify(result?.content)).toContain("answer from query-docs now");
  });

  test("a 202 becomes a task for a client that declared tasks", async () => {
    fetchMock.mockResolvedValue(indexing202(45));
    const { result } = await grep(true);
    expect(result).toMatchObject({ resultType: "task", status: "working", pollIntervalMs: 45_000 });
    expect(result?.ttlMs).toBe(CODE_TASK_TTL_MS);
    const record = await findCodeTask(store, String(result?.taskId), CALLER);
    expect(record).toMatchObject({ tool: "grep-code", status: "working" });
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
    const call = (method: string, id = taskId, tasks = true) =>
      rpc(store, method, { taskId: id }, { name: id, tasks });

    expect((await call("tasks/get")).result).toMatchObject({ taskId, status: "working" });
    for (const method of ["tasks/update", "tasks/cancel"]) {
      const answer = await call(method);
      expect(answer.error).toBeUndefined();
      expect(answer.result?.taskId).toBeUndefined();
    }
    expect((await call("tasks/get")).result).toMatchObject({ taskId, status: "cancelled" });

    for (const method of ["tasks/get", "tasks/update", "tasks/cancel"]) {
      expect((await call(method, "abc")).error).toMatchObject({ code: -32602 });
      expect((await call(method, taskId, false)).error).toMatchObject({ code: -32021 });
    }
  });
});
