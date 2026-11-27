import {
  McpServer,
  PROTOCOL_VERSION_META_KEY,
  ProtocolError,
  createMcpHandler,
} from "@modelcontextprotocol/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../src/lib/auth-lifecycle-telemetry.js", () => ({ recordToolCallTelemetry: vi.fn() }));
vi.mock("../src/lib/telemetry-runtime.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/telemetry-runtime.js")>()),
  recordToolCallOutcome: vi.fn(),
}));

import { recordToolCallTelemetry } from "../src/lib/auth-lifecycle-telemetry.js";
import { recordToolCallOutcome } from "../src/lib/telemetry-runtime.js";
import {
  CODE_TASK_TTL_MS,
  CODE_TASK_WAIT_MS,
  MAX_TASK_ID_LENGTH,
  TASKS_EXTENSION,
  cancelCodeTask,
  clientDeclaresTasks,
  createCodeTask,
  getCodeTask,
  pollSeconds,
} from "../src/lib/code-task.js";
import { codeToolResult, registerCodeTools } from "../src/lib/code-tools.js";
import type { ClientContext } from "../src/lib/types.js";

const API_TASK = "AbCdEfGhIjKlMnOpQrStUv";
const TASK = `grep-code.${API_TASK}`;
const CALLER: ClientContext = { transport: "http", apiKey: "ctx7sk-one" };
const T0 = 1_800_000_000_000;
const MESSAGE = "The source of /honojs/hono at v4.7.0 is being indexed.";
const RESULT_TEXT = 'Library: /honojs/hono at v4.7.0\n2 matching lines in 1 files for "serve"';
const MODERN = { [PROTOCOL_VERSION_META_KEY]: "2026-07-28" };

const created = (extra: Record<string, string> = {}) => ({
  "X-Context7-Task-Created": String(T0),
  ...extra,
});
function indexing202(retryAfter = 60, taskId?: string, headers = created()): Response {
  return Response.json(
    { error: "indexing", message: MESSAGE, retryAfter, ...(taskId ? { taskId } : {}) },
    { status: 202, headers }
  );
}
const result200 = (headers = created()) => new Response(RESULT_TEXT, { headers });

let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

beforeEach(() => {
  vi.mocked(recordToolCallTelemetry).mockClear();
  vi.mocked(recordToolCallOutcome).mockClear();
  fetchMock = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const poll = (seconds: number, taskId = TASK, context = CALLER) =>
  getCodeTask(taskId, context, codeToolResult, T0 + seconds * 1000);

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

describe("createCodeTask", () => {
  test("names the tool and the API's task, and asks to poll after retryAfter", () => {
    const task = createCodeTask(
      "grep-code",
      { message: MESSAGE, retryAfter: 90, taskId: API_TASK },
      T0
    );
    expect(task).toMatchObject({
      taskId: TASK,
      status: "working",
      ttlMs: CODE_TASK_TTL_MS,
      pollIntervalMs: 90_000,
      createdAt: new Date(T0).toISOString(),
    });
    expect(task?.statusMessage).toContain(MESSAGE);
    expect(task!.taskId.length).toBeLessThanOrEqual(MAX_TASK_ID_LENGTH);
  });

  test("makes no task when the API named none", () => {
    expect(createCodeTask("grep-code", { message: MESSAGE, retryAfter: 60 })).toBeNull();
  });
});

describe("poll interval", () => {
  test("is never below retryAfter, and at least 30 seconds", () => {
    for (const retryAfter of [undefined, 1, 29.2, 30, 45.5, 60, 120]) {
      expect(pollSeconds(retryAfter)).toBeGreaterThanOrEqual(retryAfter ?? 0);
      expect(pollSeconds(retryAfter)).toBeGreaterThanOrEqual(30);
    }
  });
});

describe("getCodeTask", () => {
  test("polls the API's task with the poll's credential", async () => {
    fetchMock.mockResolvedValue(indexing202());
    await poll(60, TASK, { apiKey: "ctx7sk-refreshed" });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toMatch(new RegExp(`/v2/code/tasks/${API_TASK}$`));
    expect(init?.method).toBe("GET");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer ctx7sk-refreshed");
  });

  test("answers working with the API's message, interval and creation time", async () => {
    fetchMock.mockResolvedValue(indexing202(120));
    const view = await poll(60);
    expect(view).toMatchObject({
      taskId: TASK,
      status: "working",
      pollIntervalMs: 120_000,
      createdAt: new Date(T0).toISOString(),
    });
    expect(view.statusMessage).toContain(MESSAGE);
  });

  test("completes with the result the tool returns, and marks its outcome once", async () => {
    fetchMock.mockResolvedValueOnce(result200());
    const view = await poll(60);
    expect(view.status).toBe("completed");
    expect(view.result).toEqual({ content: [{ type: "text", text: RESULT_TEXT }] });
    fetchMock.mockResolvedValueOnce(result200(created({ "X-Context7-Task-Stored": "1" })));
    expect((await poll(1200)).result).toEqual(view.result);
    expect(vi.mocked(recordToolCallOutcome).mock.calls).toEqual([["success"]]);
    expect(recordToolCallTelemetry).not.toHaveBeenCalled();
  });

  test("completes with the tool's error result when the API refuses the request", async () => {
    fetchMock.mockResolvedValue(
      Response.json(
        { error: "index_failed", message: "The tag does not exist." },
        { status: 422, headers: created() }
      )
    );
    const view = await poll(60);
    expect(view.status).toBe("completed");
    expect(view.result).toMatchObject({ isError: true });
  });

  test("ends with the API's text, not an error, when the API ends the wait (index_pending)", async () => {
    const message =
      "The source has waited more than 10 minutes to be indexed. Stop calling for it now and answer from query-docs.";
    fetchMock.mockResolvedValue(
      Response.json({ error: "index_pending", message }, { status: 503, headers: created() })
    );
    const view = await poll(60);
    expect(view.status).toBe("completed");
    expect(view.result).toEqual({ content: [{ type: "text", text: message }] });
  });

  test("waits on after the API's per-caller rate limit", async () => {
    fetchMock.mockResolvedValue(
      Response.json(
        { error: "rate_limited", message: "Too many requests." },
        { status: 429, headers: created({ "Retry-After": "20" }) }
      )
    );
    expect((await poll(60)).status).toBe("working");
  });

  test("waits on after a timeout, a gateway error or a busy code store", async () => {
    fetchMock.mockRejectedValueOnce(new Error("timeout"));
    expect((await poll(60)).status).toBe("working");
    fetchMock.mockResolvedValueOnce(new Response("Bad gateway", { status: 502 }));
    expect((await poll(120)).status).toBe("working");
    fetchMock.mockResolvedValueOnce(
      Response.json(
        { error: "code_search_unavailable", message: "Source code search is busy." },
        { status: 503, headers: created() }
      )
    );
    expect((await poll(180)).status).toBe("working");
  });

  test("ends after the 30 minute wait with the answer the call gives without a task", async () => {
    fetchMock.mockResolvedValue(indexing202());
    const view = await poll(CODE_TASK_WAIT_MS / 1000);
    expect(view.status).toBe("completed");
    expect(JSON.stringify(view.result)).toContain(MESSAGE);
    expect(JSON.stringify(view.result)).toContain("answer from query-docs now");
    expect(view.result).not.toHaveProperty("isError");
  });

  test("ends after the 30 minute wait when the API keeps timing out", async () => {
    // A timeout carries no creation time, so the poll's own clock stands in for it.
    fetchMock.mockResolvedValue(new Response("Bad gateway", { status: 502, headers: created() }));
    const view = await poll(CODE_TASK_WAIT_MS / 1000);
    expect(view.status).toBe("completed");
    expect(JSON.stringify(view.result)).toContain("answer from query-docs now");
  });

  test("answers cancelled for a cancelled task", async () => {
    fetchMock.mockResolvedValue(
      Response.json({ error: "task_cancelled" }, { status: 410, headers: created() })
    );
    expect((await poll(60)).status).toBe("cancelled");
  });

  test("rejects an unknown task, another caller's task and a malformed ID alike", async () => {
    fetchMock.mockResolvedValue(Response.json({ error: "task_not_found" }, { status: 404 }));
    await expect(poll(60)).rejects.toThrow(ProtocolError);
    await expect(poll(60)).rejects.toThrow("Unknown task");
    for (const bad of [API_TASK, `query-docs.${API_TASK}`, "grep-code.", "grep-code.a/b"])
      await expect(poll(60, bad)).rejects.toThrow("Unknown task");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("cancelCodeTask", () => {
  test("deletes the API's task, and rejects an unknown one", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await cancelCodeTask(TASK, CALLER);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toMatch(new RegExp(`/v2/code/tasks/${API_TASK}$`));
    expect(init?.method).toBe("DELETE");
    fetchMock.mockResolvedValueOnce(Response.json({ error: "task_not_found" }, { status: 404 }));
    await expect(cancelCodeTask(TASK, CALLER)).rejects.toThrow("Unknown task");
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

  const grep = (tasks: boolean) =>
    rpc(
      "tools/call",
      { name: "grep-code", arguments: { libraryId: "/honojs/hono", pattern: "serve" } },
      { name: "grep-code", tasks }
    );
  const calledUrl = () => new URL(String(fetchMock.mock.calls[0]![0]));

  test("a client that did not declare tasks asks for none and gets the text", async () => {
    fetchMock.mockResolvedValue(indexing202());
    const { result } = await grep(false);
    expect(calledUrl().searchParams.get("task")).toBeNull();
    expect(result?.resultType).toBe("complete");
    expect(result?.taskId).toBeUndefined();
    expect(JSON.stringify(result?.content)).toContain("answer from query-docs now");
    expect(vi.mocked(recordToolCallTelemetry).mock.calls).toEqual([[CALLER, "not_found"]]);
  });

  test("a client that declared tasks asks for one and gets the API's task", async () => {
    fetchMock.mockResolvedValue(indexing202(45, API_TASK));
    const { result } = await grep(true);
    expect(calledUrl().searchParams.get("task")).toBe("1");
    expect(result).toMatchObject({
      resultType: "task",
      taskId: TASK,
      status: "working",
      pollIntervalMs: 45_000,
      ttlMs: CODE_TASK_TTL_MS,
    });
    expect(vi.mocked(recordToolCallTelemetry).mock.calls).toEqual([[CALLER, "not_found"]]);
  });

  test("an API that names no task gives the text, also to a client that declared tasks", async () => {
    fetchMock.mockResolvedValue(indexing202());
    const { result } = await grep(true);
    expect(result?.resultType).toBe("complete");
    expect(JSON.stringify(result?.content)).toContain("answer from query-docs now");
  });

  test("any other answer stays synchronous for a client that declared tasks", async () => {
    fetchMock.mockResolvedValue(new Response(RESULT_TEXT));
    const { result } = await grep(true);
    expect(result?.resultType).toBe("complete");
    expect(result?.content).toEqual([{ type: "text", text: RESULT_TEXT }]);
  });

  test("the API's end of the wait (index_pending) is a normal answer, not an error", async () => {
    fetchMock.mockImplementation(async () =>
      Response.json(
        { error: "index_pending", message: "Stop calling for it now and answer from query-docs." },
        { status: 503 }
      )
    );
    for (const tasks of [false, true]) {
      const { result } = await grep(tasks);
      expect(result?.resultType).toBe("complete");
      expect(result?.isError).toBeUndefined();
    }
  });

  test("serves tasks/get, tasks/update and tasks/cancel", async () => {
    const call = (method: string, id = TASK, tasks = true) =>
      rpc(method, { taskId: id }, { name: id, tasks });

    fetchMock.mockResolvedValueOnce(indexing202());
    expect((await call("tasks/get")).result).toMatchObject({ taskId: TASK, status: "working" });
    expect((await call("tasks/update")).error).toBeUndefined();
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    expect((await call("tasks/cancel")).error).toBeUndefined();
    fetchMock.mockResolvedValueOnce(
      Response.json({ error: "task_cancelled" }, { status: 410, headers: created() })
    );
    expect((await call("tasks/get")).result).toMatchObject({ taskId: TASK, status: "cancelled" });

    fetchMock.mockImplementation(async () =>
      Response.json({ error: "task_not_found" }, { status: 404 })
    );
    for (const method of ["tasks/get", "tasks/update", "tasks/cancel"]) {
      expect((await call(method, "abc")).error).toMatchObject({ code: -32602 });
      expect((await call(method, TASK, false)).error).toMatchObject({ code: -32021 });
    }
  });
});
