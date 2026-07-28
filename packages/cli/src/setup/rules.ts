import { mkdir, readFile, writeFile } from "fs/promises";
import { dirname, join } from "path";

import { hashContent } from "../utils/content.js";
import { recordInstall } from "../utils/cli-state.js";
import { getAgent, type SetupAgent } from "./agents.js";
import type { RuleMode } from "./templates.js";

type Scope = "global" | "project";

function escapeMarker(marker: string): string {
  return marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function getRulePath(agentName: SetupAgent, scope: Scope): string {
  const rule = getAgent(agentName).rule;
  if (rule.kind === "file") {
    const dir = scope === "global" ? rule.dir("global") : join(process.cwd(), rule.dir("project"));
    return join(dir, rule.filename);
  }
  return scope === "global" ? rule.file("global") : join(process.cwd(), rule.file("project"));
}

export async function readRuleBody(agentName: SetupAgent, path: string): Promise<string | null> {
  const rule = getAgent(agentName).rule;

  let existing: string;
  try {
    existing = await readFile(path, "utf-8");
  } catch {
    return null;
  }

  if (rule.kind === "file") return existing;

  const match = existing.match(
    new RegExp(
      `${escapeMarker(rule.sectionMarker)}\\n([\\s\\S]*?)${escapeMarker(rule.sectionMarker)}`
    )
  );
  return match ? match[1] : null;
}

export async function installRule(
  agentName: SetupAgent,
  mode: RuleMode,
  scope: Scope,
  content: string,
  revision: number,
  path: string = getRulePath(agentName, scope)
): Promise<{ status: string; path: string }> {
  const rule = getAgent(agentName).rule;
  let status = "installed";

  if (rule.kind === "file") {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, "utf-8");
  } else {
    const section = `${rule.sectionMarker}\n${content}${rule.sectionMarker}`;

    let existing = "";
    try {
      existing = await readFile(path, "utf-8");
    } catch {}

    if (existing.includes(rule.sectionMarker)) {
      const marker = escapeMarker(rule.sectionMarker);
      await writeFile(
        path,
        existing.replace(new RegExp(`${marker}\\n[\\s\\S]*?${marker}`), section),
        "utf-8"
      );
      status = "updated";
    } else {
      const separator =
        existing.length > 0 && !existing.endsWith("\n") ? "\n\n" : existing.length > 0 ? "\n" : "";
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, existing + separator + section + "\n", "utf-8");
    }
  }

  await recordInstall(path, {
    kind: "rule",
    name: mode === "mcp" ? "context7-mcp.md" : "context7-cli.md",
    agent: agentName,
    scope,
    mode,
    revision,
    hash: hashContent(content),
  });

  return { status, path };
}
