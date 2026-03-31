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
        if (name.includes("resolve-library-id") || name.includes("resolve_library_id")) return true;
        if (name.includes("query-docs") || name.includes("query_docs")) return true;
      } else if (detection === "skill") {
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
        label = cmd.includes("ctx7") ? "Bash(ctx7)" : "Bash";
      } else if (name.includes("resolve-library-id") || name.includes("resolve_library_id")) {
        label = "MCP:resolve";
      } else if (name.includes("query-docs") || name.includes("query_docs")) {
        label = "MCP:query";
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
