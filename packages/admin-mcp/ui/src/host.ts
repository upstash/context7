import type {
  McpUiHostCapabilities,
  McpUiHostContext,
  McpUiInitializeResult,
} from "@modelcontextprotocol/ext-apps";

/**
 * The MCP Apps bridge (ext-apps spec 2026-01-26): JSON-RPC over postMessage
 * with the host that renders this page.
 *
 * Hand-written rather than ext-apps' `App`, which bundles zod and MCP core
 * (~230 KB) for a page that needs a handful of methods; the same choice as the
 * Upstash console. ext-apps is imported for its types only, so the wire shapes
 * are still checked against the spec's. The demo host (ui/demo) drives this
 * page through ext-apps' own `AppBridge`.
 */

/** What `open_console` returns: the teamspaces, and the page and teamspace the model asked for. */
export type ConsoleOpen = {
  teamspaces?: Teamspace[];
  open?: { view?: View; teamspace?: string };
};
export type View = "usage" | "libraries" | "docs7" | "ask";
export type Teamspace = {
  id: string;
  name: string;
  role?: string;
  isPersonal?: boolean;
  ownerPlan?: string;
};

type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void };
type Message = {
  jsonrpc?: string;
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { message?: string };
};
type ToolResult = {
  content?: { type: string; text?: string }[];
  structuredContent?: unknown;
  isError?: boolean;
};

/**
 * The JSON inside a tool's text result. Tools that return third-party text
 * fence it for the model (`formatResult` in src/server.ts):
 * a warning line, then the JSON between random `<untrusted-data-…>` tags.
 */
export function parseToolText(text: string): unknown {
  const fenced = /<(untrusted-data-[0-9a-f-]+)>\n([\s\S]*)\n<\/\1>/.exec(text);
  return JSON.parse(fenced ? fenced[2] : text);
}

export class Host {
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private listeners = new Set<() => void>();
  capabilities: McpUiHostCapabilities = {};
  context: McpUiHostContext = {};
  /** The latest `open_console` call: its arguments first, then its result. */
  opened: ConsoleOpen = {};

  constructor() {
    window.addEventListener("message", (event) => {
      if (event.source !== window.parent) return;
      this.receive(event.data as Message);
    });
  }

  private post(message: Message) {
    window.parent.postMessage({ jsonrpc: "2.0", ...message }, "*");
  }

  private changed() {
    for (const listener of this.listeners) listener();
  }

  /** For React's useSyncExternalStore. */
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };

  private receive(message: Message) {
    if (!message || message.jsonrpc !== "2.0") return;
    if (message.method === undefined && typeof message.id === "number") {
      const waiter = this.pending.get(message.id);
      if (!waiter) return;
      this.pending.delete(message.id);
      if (message.error) waiter.reject(new Error(message.error.message ?? "Request failed"));
      else waiter.resolve(message.result);
      return;
    }
    switch (message.method) {
      case "ui/notifications/host-context-changed":
        this.applyContext(message.params as McpUiHostContext);
        break;
      case "ui/notifications/tool-input": {
        const args = (message.params as { arguments?: ConsoleOpen["open"] })?.arguments;
        this.opened = { ...this.opened, open: args ?? {} };
        this.changed();
        break;
      }
      case "ui/notifications/tool-result": {
        const result = message.params as ToolResult;
        if (!result.isError && result.structuredContent) {
          this.opened = result.structuredContent as ConsoleOpen;
          this.changed();
        }
        break;
      }
    }
    if (message.id !== undefined) {
      // Host → app requests: teardown and ping take an empty result; nothing else is served.
      if (message.method === "ui/resource-teardown" || message.method === "ping") {
        this.post({ id: message.id, result: {} });
      } else if (message.method !== undefined) {
        this.post({ id: message.id, error: { message: "Method not found" } });
      }
    }
  }

  request<T>(method: string, params: object = {}): Promise<T> {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      this.post({ id, method, params });
    });
  }

  notify(method: string, params: object = {}) {
    this.post({ method, params });
  }

  private applyContext(context: McpUiHostContext) {
    this.context = { ...this.context, ...context };
    const root = document.documentElement;
    root.dataset.display = this.fullscreen ? "full" : "inline";
    if (context.theme) {
      root.dataset.theme = context.theme;
      root.style.colorScheme = context.theme;
    }
    for (const [name, value] of Object.entries(context.styles?.variables ?? {})) {
      if (value) root.style.setProperty(name, value);
    }
    const fonts = context.styles?.css?.fonts;
    if (fonts && !document.getElementById("host-fonts")) {
      const style = document.createElement("style");
      style.id = "host-fonts";
      style.textContent = fonts;
      document.head.append(style);
    }
    // Pixel insets where the host draws over the page (mobile chrome, the composer).
    const insets = context.safeAreaInsets;
    if (insets) {
      for (const side of ["top", "right", "bottom", "left"] as const) {
        root.style.setProperty(`--safe-${side}`, `${insets[side] ?? 0}px`);
      }
    }
    if (context.locale) root.lang = context.locale;
    this.changed();
  }

  private connecting?: Promise<void>;

  /** Idempotent: React's StrictMode runs effects twice in development. */
  connect() {
    this.connecting ??= this.initialize();
    return this.connecting;
  }

  private async initialize() {
    const result = await this.request<McpUiInitializeResult>("ui/initialize", {
      appInfo: { name: "context7-console", version: "0.1.0" },
      appCapabilities: { availableDisplayModes: ["inline", "fullscreen"] },
      protocolVersion: "2026-01-26",
    });
    this.capabilities = result.hostCapabilities ?? {};
    this.applyContext(result.hostContext ?? {});
    this.notify("ui/notifications/initialized");
    this.watchSize();
  }

  /** Inline the host sizes the frame from the reported height, so the page never scrolls inside. */
  private watchSize() {
    let last = "";
    const report = () => {
      // Rounded up: a fractional height (0.5px borders) would leave a sliver to scroll.
      const height = Math.ceil(document.documentElement.getBoundingClientRect().height);
      const size = { width: window.innerWidth, height };
      const key = `${size.width}x${size.height}`;
      if (key === last) return;
      last = key;
      this.notify("ui/notifications/size-changed", size);
    };
    new ResizeObserver(report).observe(document.documentElement);
  }

  /** Calls a tool of this server through the host and returns the JSON it answered. */
  async callTool<T>(name: string, args: object = {}): Promise<T> {
    const result = await this.request<ToolResult>("tools/call", { name, arguments: args });
    const text = (result.content ?? [])
      .filter((block) => block.type === "text")
      .map((block) => block.text ?? "")
      .join("\n");
    if (result.isError) throw new Error(text || `${name} failed`);
    if (result.structuredContent !== undefined) return result.structuredContent as T;
    try {
      return parseToolText(text) as T;
    } catch {
      // A result over the server's size cap ends in a note instead of closing JSON.
      throw new Error(`${name} answered more data than the console can read.`);
    }
  }

  /** Tells the model what the user is looking at, so "why is this low?" has a referent. */
  setModelContext(text: string) {
    if (!this.capabilities.updateModelContext) return;
    this.request("ui/update-model-context", { content: [{ type: "text", text }] }).catch(() => {});
  }

  get canMessage() {
    return Boolean(this.capabilities.message);
  }

  /** Puts a prompt in the chat as the user, for "Ask about this" buttons. */
  sendMessage(text: string) {
    return this.request("ui/message", { role: "user", content: [{ type: "text", text }] });
  }

  openLink(url: string) {
    if (!this.capabilities.openLinks) return void window.open(url, "_blank", "noopener");
    this.request("ui/open-link", { url }).catch(() => {});
  }

  /** Fullscreen or picture-in-picture: the page has the host's whole area and may scroll. */
  get fullscreen() {
    return this.context.displayMode === "fullscreen" || this.context.displayMode === "pip";
  }

  /** The host can take the page fullscreen (it has its own close button there). */
  get canFullscreen() {
    return (this.context.availableDisplayModes ?? []).includes("fullscreen");
  }

  async requestDisplayMode(mode: "inline" | "fullscreen") {
    const result = await this.request<{ mode?: "inline" | "fullscreen" }>(
      "ui/request-display-mode",
      { mode }
    );
    this.applyContext({ displayMode: result.mode ?? mode });
  }
}

export const host = new Host();
