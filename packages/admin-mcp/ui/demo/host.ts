import type { McpUiHostContext } from "@modelcontextprotocol/ext-apps";
import { AppBridge, PostMessageTransport } from "@modelcontextprotocol/ext-apps/app-bridge";
import { callTool } from "./backend";

/**
 * Demo host: renders the console the way an MCP Apps host does, with
 * ext-apps' reference AppBridge, and answers its tool calls from the fake
 * backend. The side panel logs the tool calls and what the page tells the model.
 */

const params = new URLSearchParams(location.search);
const theme: "light" | "dark" = params.get("theme") === "dark" ? "dark" : "light";
const displayParam = params.get("display") ?? "inline";
// "inline-only" plays a host without fullscreen (the page then shows the whole console inline).
const canFullscreen = displayParam !== "inline-only";
let display: "inline" | "fullscreen" = displayParam === "fullscreen" ? "fullscreen" : "inline";
const view = params.get("view") ?? "";
// ?teamspace= plays the model naming one, by id or name; an unknown name plays the tool's error.
const teamspace = params.get("teamspace") ?? "";
const width = params.get("width") ?? "";
const tokens = params.get("tokens") ?? "claude";
document.documentElement.dataset.theme = theme;
document.body.dataset.display = display;
if (width) document.documentElement.style.setProperty("--chat-width", `${width}px`);

/** Claude's MCP Apps style variables (claude.com/docs/connectors/building/mcp-apps/design-guidelines). */
const CLAUDE = {
  light: {
    "--color-background-primary": "#FFFFFF",
    "--color-background-secondary": "#F5F4ED",
    "--color-background-tertiary": "#FAF9F5",
    "--color-background-inverse": "#141413",
    "--color-text-primary": "#141413",
    "--color-text-secondary": "#3D3D3A",
    "--color-text-tertiary": "#73726C",
    "--color-text-inverse": "#FAF9F5",
    "--color-border-primary": "rgb(31 30 29 / 0.4)",
    "--color-text-success": "#265B19",
    "--color-text-danger": "#7F2C28",
    "--color-text-warning": "#5A4815",
    "--color-text-info": "#3266AD",
  },
  dark: {
    "--color-background-primary": "#30302E",
    "--color-background-secondary": "#262624",
    "--color-background-tertiary": "#141413",
    "--color-background-inverse": "#FAF9F5",
    "--color-text-primary": "#FAF9F5",
    "--color-text-secondary": "#C2C0B6",
    "--color-text-tertiary": "#9C9A92",
    "--color-text-inverse": "#141413",
    "--color-border-primary": "rgb(222 220 209 / 0.4)",
    "--color-text-success": "#7AB948",
    "--color-text-danger": "#EE8884",
    "--color-text-warning": "#D1A041",
    "--color-text-info": "#80AADD",
  },
  shared: {
    "--font-sans": "ui-sans-serif, system-ui, -apple-system, sans-serif",
    "--font-text-sm-size": "14px",
    "--border-radius-sm": "6px",
    "--border-radius-md": "8px",
    "--border-radius-lg": "10px",
    "--border-width-regular": "0.5px",
  },
};

const log = document.getElementById("log")!;
function record(kind: string, text: string) {
  const item = document.createElement("div");
  item.className = "entry";
  const head = document.createElement("div");
  head.className = "kind";
  head.textContent = `${new Date().toLocaleTimeString()} · ${kind}`;
  const body = document.createElement("div");
  body.textContent = text;
  item.append(head, body);
  log.prepend(item);
}

for (const [id, value] of [
  ["theme", theme],
  ["display", displayParam],
  ["width", width],
  ["tokens", tokens],
  ["view", view],
] as const) {
  const select = document.getElementById(id) as HTMLSelectElement;
  select.value = value;
  select.onchange = () => {
    params.set(id, select.value);
    location.search = params.toString();
  };
}

const context = (): McpUiHostContext => ({
  theme,
  displayMode: display,
  availableDisplayModes: (canFullscreen ? ["inline", "fullscreen"] : ["inline"]) as (
    "inline" | "fullscreen"
  )[],
  platform: "web" as const,
  ...(tokens === "claude"
    ? {
        styles: {
          variables: { ...CLAUDE.shared, ...CLAUDE[theme] } as NonNullable<
            McpUiHostContext["styles"]
          >["variables"],
        },
      }
    : {}),
});

const iframe = document.getElementById("app") as HTMLIFrameElement;
const bridge = new AppBridge(
  null,
  { name: "Demo host", version: "1" },
  { serverTools: {}, updateModelContext: { text: {} }, message: { text: {} }, openLinks: {} },
  { hostContext: context() }
);
// Inline the frame follows the page's reported height, as Claude and ChatGPT do.
bridge.onsizechange = ({ height }) => {
  if (display === "inline" && height) iframe.style.height = `${height}px`;
};
bridge.onrequestdisplaymode = async ({ mode }) => {
  display = mode === "inline" ? "inline" : "fullscreen";
  document.body.dataset.display = display;
  (document.getElementById("display") as HTMLSelectElement).value = display;
  iframe.style.height = "";
  record("display mode", display);
  bridge.setHostContext(context());
  return { mode: display };
};
// As ChatGPT does: the page may call only app-visible tools (console_data), and it gets the
// result's structuredContent.
bridge.oncalltool = async (request) => {
  const { tool, arguments: args = {} } = (request.arguments ?? {}) as {
    tool?: string;
    arguments?: Record<string, unknown>;
  };
  record("tool call from the page", `${tool} ${JSON.stringify(args)}`);
  if (request.name !== "console_data") {
    return {
      isError: true,
      content: [{ type: "text", text: `${request.name} is not visible to the app.` }],
    };
  }
  try {
    return {
      content: [{ type: "text", text: `${tool} data for the Context7 console.` }],
      structuredContent: callTool(tool!, args) as Record<string, unknown>,
    };
  } catch (error) {
    const text = (error as Error).message;
    return { isError: true, content: [{ type: "text", text }], structuredContent: { error: text } };
  }
};
bridge.onupdatemodelcontext = async (request) => {
  record("model context", (request.content?.[0] as { text?: string } | undefined)?.text ?? "");
  return {};
};
bridge.onmessage = async (request) => {
  record("message sent to the chat", (request.content[0] as { text?: string }).text ?? "");
  return {};
};
bridge.onopenlink = async (request) => {
  window.open(request.url, "_blank", "noopener");
  return {};
};
// Plays the model calling open_console: its arguments, then its result.
bridge.oninitialized = () => {
  const args = { ...(view && { view }), ...(teamspace && { teamspace }) };
  record("model called", `open_console ${JSON.stringify(args)}`);
  bridge.sendToolInput({ arguments: args });
  try {
    const result = callTool("open_console", args) as Record<string, unknown>;
    bridge.sendToolResult({
      content: [{ type: "text", text: JSON.stringify(result) }],
      structuredContent: result,
    });
  } catch (error) {
    bridge.sendToolResult({
      isError: true,
      content: [{ type: "text", text: (error as Error).message }],
    });
  }
};
await bridge.connect(new PostMessageTransport(iframe.contentWindow!, iframe.contentWindow!));
iframe.srcdoc = await (await fetch("console.html")).text();
