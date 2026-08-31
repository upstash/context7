import { readFile } from "node:fs/promises";
import { Context } from "@deepseek-ai/cordis";
import CredentialProvider, {
  credentialRef,
  type CredentialInfo,
  type CredentialRef,
  type ResolvedCredential,
} from "@deepseek-ai/dsh-credentials";
import SystemPrompt, { renderPrompt, type PromptSection } from "@deepseek-ai/dsh-system-prompt";
import ToolRuntime, { type ToolDefinition, type ToolExecutionInput } from "@deepseek-ai/dsh-tools";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as context7 from "../src/index.js";

const { apply } = context7;
const API_KEY_REF = credentialRef("CONTEXT7_API_KEY");

class MemoryCredentials extends CredentialProvider {
  private apiKey?: string;

  constructor(ctx: Context, config: { apiKey?: string } = {}) {
    super(ctx);
    this.apiKey = config.apiKey;
  }

  resolve(ref: CredentialRef): Promise<ResolvedCredential | undefined> {
    return Promise.resolve(
      ref === API_KEY_REF && this.apiKey ? { value: this.apiKey, source: "memory" } : undefined
    );
  }

  describe(ref: CredentialRef): Promise<CredentialInfo> {
    return Promise.resolve({
      configured: ref === API_KEY_REF && Boolean(this.apiKey),
      writable: true,
    });
  }

  set(ref: CredentialRef, value: string): Promise<void> {
    if (ref === API_KEY_REF) this.apiKey = value;
    return Promise.resolve();
  }

  unset(ref: CredentialRef): Promise<void> {
    if (ref === API_KEY_REF) this.apiKey = undefined;
    return Promise.resolve();
  }
}

function loadTools(apiKey?: string): Map<string, ToolDefinition> {
  const tools = new Map<string, ToolDefinition>();
  const ctx = {
    credentials: {
      resolve: () => Promise.resolve(apiKey ? { value: apiKey, source: "memory" } : undefined),
    },
    tools: {
      register(tool: ToolDefinition) {
        tools.set(tool.name, tool);
      },
    },
    systemPrompt: {
      section(_section: PromptSection) {
        return () => undefined;
      },
    },
  } as unknown as Context;
  apply(ctx);
  return tools;
}

async function loadRuntime(apiKey?: string): Promise<Context> {
  const root = new Context();
  await root.plugin(MemoryCredentials, { apiKey });
  await root.plugin(SystemPrompt, {
    includeHarnessIdentity: false,
    includeRuntimeContext: false,
    persona: "",
  });
  await root.plugin(ToolRuntime);
  await root.plugin(context7);
  return root;
}

function execution() {
  return { signal: new AbortController().signal } as never;
}

function toolInput(
  name: string,
  args: Record<string, string>,
  signal = new AbortController().signal
): ToolExecutionInput {
  return {
    callId: name as never,
    name,
    arguments: args,
    signal,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Context7 DeepSeek Harness plugin", () => {
  it("registers both Context7 tools", () => {
    const tools = loadTools();
    expect([...tools.keys()]).toEqual(["resolve-library-id", "query-docs"]);
    expect([...tools.values()].map(({ timeoutMs }) => timeoutMs)).toEqual([60_000, 60_000]);
  });

  it("activates the bundle in the real Cordis tool runtime", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: URL) =>
        Promise.resolve(
          input.pathname.endsWith("/libs/search")
            ? new Response(
                JSON.stringify({
                  results: [
                    {
                      id: "/vercel/next.js",
                      title: "Next.js",
                      description: "The React framework",
                    },
                  ],
                })
              )
            : new Response("Current documentation")
        )
      )
    );

    const manifest = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8")
    ) as { dsh: { bundle: { patch: string } } };
    const patch = await readFile(
      new URL(`../${manifest.dsh.bundle.patch}`, import.meta.url),
      "utf8"
    );
    expect(patch).toBe(
      '- insert:\n    - id: context7\n      name: "@upstash/context7-deepseek-harness"\n'
    );

    const root = await loadRuntime();

    const toolNames = ["resolve-library-id", "query-docs"];
    expect(root.tools.schemas().map(({ name }) => name)).toEqual(toolNames);
    const assembly = await root.systemPrompt.assemble();
    expect(assembly.tools.map(({ name }) => name).sort()).toEqual([...toolNames].sort());
    const prompt = renderPrompt(assembly);
    expect(prompt).toContain(
      "Use Context7 to fetch current documentation whenever the user asks about a library"
    );
    expect(prompt).toContain(
      "Do not use Context7 for refactoring, writing scripts from scratch, debugging business logic"
    );
    expect(prompt).toContain(
      "Call resolve-library-id with the official library name and the user's specific goal"
    );
    expect(context7.inject).toEqual(["credentials", "tools", "systemPrompt"]);
    const resolveInput = toolInput("resolve-library-id", {
      query: "middleware",
      libraryName: "Next.js",
    });
    const queryInput = toolInput("query-docs", {
      libraryId: "/vercel/next.js",
      query: "middleware",
    });
    expect(root.tools.executionMode(resolveInput)).toEqual({ kind: "parallel" });
    expect(root.tools.executionMode(queryInput)).toEqual({ kind: "parallel" });

    const results = await Promise.all([
      root.tools.execute(resolveInput),
      root.tools.execute(queryInput),
    ]);
    expect(results.map(({ isError }) => isError)).toEqual([false, false]);

    await root.fiber.dispose();
  });

  it("propagates cancellation to Context7 requests", async () => {
    let notifyFetchStarted: () => void = () => undefined;
    let observedSignal: AbortSignal | undefined;
    const fetchStarted = new Promise<void>((resolve) => {
      notifyFetchStarted = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn((_input: URL, init?: RequestInit) => {
        const signal = init?.signal;
        if (!signal) throw new Error("Missing request signal");
        observedSignal = signal;
        notifyFetchStarted();
        return new Promise<Response>((_resolve, reject) => {
          const abort = () => reject(signal.reason);
          if (signal.aborted) abort();
          else signal.addEventListener("abort", abort, { once: true });
        });
      })
    );

    const root = await loadRuntime();
    const controller = new AbortController();
    const pending = root.tools.execute(
      toolInput(
        "query-docs",
        { libraryId: "/vercel/next.js", query: "middleware" },
        controller.signal
      )
    );
    await fetchStarted;
    controller.abort(new Error("cancelled"));

    await expect(pending).resolves.toMatchObject({ isError: true });
    expect(observedSignal?.aborted).toBe(true);

    await root.fiber.dispose();
  });

  it("resolves libraries with authentication and formats the response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          searchFilterApplied: true,
          results: [
            {
              id: "/vercel/next.js",
              title: "Next.js",
              description: "The React framework",
              totalSnippets: 100,
              trustScore: 10,
              benchmarkScore: 92,
              versions: ["v15.1.8"],
              source: "https://nextjs.org/docs",
            },
          ],
        })
      )
    );
    vi.stubGlobal("fetch", fetchMock);
    const tool = loadTools("ctx7sk-test").get("resolve-library-id")!;
    const result = await tool.execute({ query: "middleware", libraryName: "Next.js" }, execution());

    expect(result).toContain("/vercel/next.js");
    expect(result).toContain("teamspace's library filters");
    expect(result).toContain("Source: https://nextjs.org/docs");
    expect(fetchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        href: expect.stringContaining("libraryName=Next.js"),
      }),
      expect.objectContaining({
        headers: { Authorization: "Bearer ctx7sk-test" },
      })
    );
  });

  it("resolves the Context7 credential for every request", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("Current documentation"));
    vi.stubGlobal("fetch", fetchMock);
    const root = await loadRuntime("ctx7sk-first");
    const input = toolInput("query-docs", {
      libraryId: "/vercel/next.js",
      query: "middleware",
    });

    await root.tools.execute(input);
    await root.credentials.set(API_KEY_REF, "ctx7sk-second");
    await root.tools.execute(input);

    expect(fetchMock.mock.calls.map(([, init]) => init.headers.Authorization)).toEqual([
      "Bearer ctx7sk-first",
      "Bearer ctx7sk-second",
    ]);

    await root.fiber.dispose();
  });

  it("queries documentation without requiring an API key", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("Current documentation"));
    vi.stubGlobal("fetch", fetchMock);
    const tool = loadTools().get("query-docs")!;
    const result = await tool.execute(
      { libraryId: "/vercel/next.js", query: "middleware" },
      execution()
    );

    expect(result).toBe("Current documentation");
    expect(fetchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        href: expect.stringContaining("libraryId=%2Fvercel%2Fnext.js"),
      }),
      expect.objectContaining({ headers: {} })
    );
  });
});
