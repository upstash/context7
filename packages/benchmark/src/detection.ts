import type { DetectionMethod } from "./types.js";

interface ToolUseBlock {
  type: "tool_use";
  name: string;
  input: Record<string, unknown>;
}

interface StreamEvent {
  type?: string;
  message?: {
    content?: ToolUseBlock[];
  };
}

// Detect by MCP server namespace prefix -- no hardcoded tool lists needed.
// Claude Code names MCP tools as `mcp__<server>__<tool>` or uses the raw tool name
// when only one server provides it.

function isContext7Tool(name: string): boolean {
  if (name.startsWith("mcp__context7__")) return true;
  return (
    name.includes("resolve-library-id") ||
    name.includes("resolve_library_id") ||
    name.includes("query-docs") ||
    name.includes("query_docs")
  );
}

function isNiaTool(name: string): boolean {
  if (name.startsWith("mcp__nia__")) return true;
  // Nia-prefixed tool names (nia_web_search, nia_deep_research_agent, etc.)
  if (name.startsWith("nia_")) return true;
  return false;
}

function isNiaSkillCall(name: string, input: Record<string, unknown>): boolean {
  if (name === "Skill") {
    const inputStr = JSON.stringify(input);
    if (inputStr.includes("nia")) return true;
  }
  if (name === "Bash") {
    const command = String(input.command ?? "");
    if (
      command.includes("scripts/nia") ||
      command.includes("scripts/search") ||
      command.includes("scripts/repos") ||
      command.includes("scripts/sources")
    )
      return true;
  }
  return false;
}

export function detectTrigger(detection: DetectionMethod, stdout: string): boolean {
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let event: StreamEvent;
    try {
      event = JSON.parse(trimmed);
    } catch {
      continue;
    }

    if (event.type !== "assistant") continue;

    const content = event.message?.content ?? [];
    for (const block of content) {
      if (block.type !== "tool_use") continue;
      const name = block.name ?? "";
      const toolInput = block.input ?? {};

      if (detection === "mcp") {
        if (isContext7Tool(name)) return true;
      }
      if (detection === "versus") {
        if (isContext7Tool(name)) return true;
        if (isNiaTool(name) || isNiaSkillCall(name, toolInput)) return true;
        if (name === "Skill" && JSON.stringify(toolInput).includes("find-docs")) return true;
        if (name === "Bash") {
          const command = String(toolInput.command ?? "");
          if (command.includes("ctx7") || command.includes("context7")) return true;
        }
      }
      if (detection === "nia") {
        if (isNiaTool(name) || isNiaSkillCall(name, toolInput)) return true;
      }
      if (detection === "skill") {
        if (name === "Skill") {
          const inputStr = JSON.stringify(toolInput);
          if (inputStr.includes("find-docs")) return true;
        }
        if (name === "Bash") {
          const command = String(toolInput.command ?? "");
          if (command.includes("ctx7") || command.includes("context7")) return true;
        }
      } else if (detection === "cli") {
        if (name === "Bash") {
          const command = String(toolInput.command ?? "");
          if (command.includes("ctx7") || command.includes("context7")) return true;
        }
      }
    }
  }

  return false;
}

export function detectVersusProvider(stdout: string): "context7" | "nia" | "both" | "neither" {
  let ctx7 = false;
  let nia = false;

  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let event: StreamEvent;
    try {
      event = JSON.parse(trimmed);
    } catch {
      continue;
    }

    if (event.type !== "assistant") continue;

    for (const block of event.message?.content ?? []) {
      if (block.type !== "tool_use") continue;
      const name = block.name ?? "";
      const inp = block.input ?? {};
      if (isContext7Tool(name)) ctx7 = true;
      if (name === "Skill" && JSON.stringify(inp).includes("find-docs")) ctx7 = true;
      if (name === "Bash") {
        const cmd = String(inp.command ?? "");
        if (cmd.includes("ctx7") || cmd.includes("context7")) ctx7 = true;
      }
      if (isNiaTool(name) || isNiaSkillCall(name, inp)) nia = true;
    }
  }

  if (ctx7 && nia) return "both";
  if (ctx7) return "context7";
  if (nia) return "nia";
  return "neither";
}

export function extractToolChain(stdout: string): string | null {
  const tools: string[] = [];
  const seen = new Set<string>();

  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let event: StreamEvent;
    try {
      event = JSON.parse(trimmed);
    } catch {
      continue;
    }

    if (event.type !== "assistant") continue;

    for (const block of event.message?.content ?? []) {
      if (block.type !== "tool_use") continue;
      const name = block.name ?? "";
      const inp = block.input ?? {};

      let label: string;

      if (name === "Skill") {
        const skillId =
          (inp.name as string) ||
          (inp.skill as string) ||
          (inp.skill_name as string) ||
          (inp.query as string) ||
          "";
        let resolved = skillId;
        if (!resolved) {
          for (const v of Object.values(inp)) {
            if (typeof v === "string" && v.length < 100) {
              resolved = v;
              break;
            }
          }
        }
        label = `Skill(${resolved || "?"})`;
      } else if (name === "ToolSearch") {
        label = "ToolSearch";
      } else if (name === "Bash") {
        const cmd = String(inp.command ?? "");
        if (cmd.includes("ctx7")) label = "Bash(ctx7)";
        else if (
          cmd.includes("scripts/nia") ||
          cmd.includes("scripts/search") ||
          cmd.includes("scripts/repos") ||
          cmd.includes("scripts/sources")
        )
          label = "Bash(nia)";
        else label = "Bash";
      } else if (isContext7Tool(name)) {
        label = name.includes("resolve") ? "ctx7:resolve" : "ctx7:query";
      } else if (isNiaTool(name)) {
        const short = name.replace("mcp__nia__", "");
        label = `nia:${short}`;
      } else {
        label = name;
      }

      if (!seen.has(label)) {
        tools.push(label);
        seen.add(label);
      }
    }
  }

  return tools.length > 0 ? tools.join(" -> ") : null;
}
