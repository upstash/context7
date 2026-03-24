#!/usr/bin/env python3
"""Orchestrator: benchmarks different Context7 integration channels.

Tests which setup users should use for best trigger accuracy:
  - MCP server (tool presence alone)
  - MCP + alwaysApply rule
  - MCP + CLAUDE.md instructions
  - CLI skill (find-docs SKILL.md)
  - CLI + CLAUDE.md (ctx7 instructions baked into CLAUDE.md, no skill)
  - CLI + rule (ctx7 instructions in alwaysApply rule, no skill)

For each mode, arranges the environment, runs eval queries via `claude -p`,
and checks whether the expected tool call was made.

Usage:
    python orchestrator.py
    python orchestrator.py --modes mcp,skill,cli+claude.md
    python orchestrator.py --model claude-sonnet-4-6 --workers 10
"""

import argparse
import json
import os
import shutil
import subprocess
import sys
import time
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path

# --- Paths ---
PROJECT_ROOT = Path("/Users/fahreddinozcan/Desktop/repos/context7")
EVAL_SET = PROJECT_ROOT / "skills/find-docs-workspace/trigger-eval.json"
SKILL_SNAPSHOT = PROJECT_ROOT / "skills/find-docs-workspace/skill-snapshot/SKILL.md"
RESULTS_DIR = PROJECT_ROOT / "skills/find-docs-workspace/orchestrator-results"

# Claude config paths
CLAUDE_DIR = Path.home() / ".claude"
RULES_DIR = CLAUDE_DIR / "rules"
SKILLS_DIR = CLAUDE_DIR / "skills"
GLOBAL_MCP_CONFIG = CLAUDE_DIR / ".mcp.json"
PROJECT_MCP_CONFIG = PROJECT_ROOT / ".mcp.json"
RULE_FILE = RULES_DIR / "context7.md"
SKILL_DEST_GLOBAL = SKILLS_DIR / "find-docs" / "SKILL.md"
SKILL_DEST_PROJECT = PROJECT_ROOT / ".claude" / "skills" / "find-docs" / "SKILL.md"
SKILL_DEST_AGENTS = PROJECT_ROOT / ".agents" / "skills" / "find-docs" / "SKILL.md"
CLAUDE_MD = PROJECT_ROOT / "CLAUDE.md"

# MCP server config
MCP_LOCAL_PORT = 4247
MCP_SERVER_ENTRY = {
    "mcpServers": {
        "context7": {
            "type": "http",
            "url": f"http://localhost:{MCP_LOCAL_PORT}/mcp"
        }
    }
}
MCP_EMPTY = {"mcpServers": {}}

# Conversation context prefixes to simulate mid-session queries
CONTEXT_PREFIXES = [
    (
        "I've been working on this codebase for a while. So far I:\n"
        "- Read through src/routes/api.ts and fixed the auth middleware\n"
        "- Ran the test suite, 3 tests are still failing\n"
        "- Updated package.json dependencies\n\n"
        "Now: "
    ),
    (
        "I'm in the middle of a refactor. Just finished:\n"
        "- Moved the database models to a new directory\n"
        "- Fixed the import paths in 12 files\n"
        "- The CI is green now\n\n"
        "Quick question: "
    ),
    (
        "Been debugging this for an hour. Already tried:\n"
        "- Checked the logs, nothing obvious\n"
        "- Added some console.logs in the handler\n"
        "- Restarted the dev server\n\n"
        "Anyway, unrelated but: "
    ),
    (
        "Just got off a call with the team. Before I forget: "
    ),
    (
        "Working through my backlog today. Next up: "
    ),
]

# --- Instruction content ---
# MCP-oriented instructions (references resolve-library-id / query-docs)
MCP_INSTRUCTIONS = (
    "Before answering a question about a specific library or framework's API, "
    "first check whether the question actually needs external documentation. "
    "Only call Context7 MCP when the user is asking about how a specific "
    "third-party library works -- its API, syntax, configuration, version "
    "changes, or behavior.\n\n"
    "Examples where you SHOULD call Context7: \"how do I use useEffect in React\", "
    "\"Prisma one-to-many syntax\", \"what changed in Tailwind v4\"\n\n"
    "Examples where you should NOT call Context7: refactoring code, writing scripts, "
    "debugging logic errors, code review\n\n"
    "## When you decide Context7 is needed\n\n"
    "1. Call `resolve-library-id` with the library name and the user's question\n"
    "2. Pick the best match\n"
    "3. Call `query-docs` with the selected library ID and the user's question\n"
    "4. Answer using the fetched docs\n"
)

# CLI-oriented instructions (references ctx7 CLI commands via Bash)
CLI_INSTRUCTIONS = (
    "Before answering a question about a specific library or framework's API, "
    "first check whether the question actually needs external documentation. "
    "Only use the Context7 CLI when the user is asking about how a specific "
    "third-party library works -- its API, syntax, configuration, version "
    "changes, or behavior.\n\n"
    "Examples where you SHOULD use Context7: \"how do I use useEffect in React\", "
    "\"Prisma one-to-many syntax\", \"what changed in Tailwind v4\"\n\n"
    "Examples where you should NOT use Context7: refactoring code, writing scripts, "
    "debugging logic errors, code review\n\n"
    "## When you decide Context7 is needed\n\n"
    "Use the `ctx7` CLI (install with `npm install -g ctx7@latest` or use `npx ctx7@latest`):\n\n"
    "1. Resolve library: `ctx7 library <name> \"<query>\"`\n"
    "2. Pick the best match from results\n"
    "3. Fetch docs: `ctx7 docs <libraryId> \"<query>\"`\n"
    "4. Answer using the fetched documentation\n\n"
    "Example:\n"
    "```bash\n"
    "ctx7 library react \"useEffect cleanup with async\"\n"
    "ctx7 docs /facebook/react \"useEffect cleanup with async\"\n"
    "```\n"
)


# --- Mode definitions ---
# Each mode specifies which components to enable and how to detect triggers.
# detection: "mcp" checks for resolve-library-id/query-docs tool calls
#            "skill" checks for Skill(find-docs) invocation
#            "cli" checks for Bash calls containing ctx7
MODE_CONFIGS = {
    # MCP-based modes (server provides tools directly)
    "mcp": {
        "mcp": True, "rule": False, "skill": False, "claude_md": False,
        "rule_content": None, "claude_md_content": None,
        "detection": "mcp",
        "description": "MCP server only, no instructions",
    },
    "mcp+rule": {
        "mcp": True, "rule": True, "skill": False, "claude_md": False,
        "rule_content": MCP_INSTRUCTIONS, "claude_md_content": None,
        "detection": "mcp",
        "description": "MCP server + alwaysApply rule with MCP instructions",
    },
    "mcp+claude.md": {
        "mcp": True, "rule": False, "skill": False, "claude_md": True,
        "rule_content": None, "claude_md_content": MCP_INSTRUCTIONS,
        "detection": "mcp",
        "description": "MCP server + CLAUDE.md with MCP instructions",
    },
    # CLI-based modes (ctx7 CLI via Bash)
    "cli+skill": {
        "mcp": False, "rule": False, "skill": True, "claude_md": False,
        "rule_content": None, "claude_md_content": None,
        "detection": "skill",
        "description": "find-docs SKILL.md only (ctx7 CLI via skill)",
    },
    "cli+claude.md": {
        "mcp": False, "rule": False, "skill": False, "claude_md": True,
        "rule_content": None, "claude_md_content": CLI_INSTRUCTIONS,
        "detection": "cli",
        "description": "CLAUDE.md with ctx7 CLI instructions (no skill, no MCP)",
    },
    "cli+rule": {
        "mcp": False, "rule": True, "skill": False, "claude_md": False,
        "rule_content": CLI_INSTRUCTIONS, "claude_md_content": None,
        "detection": "cli",
        "description": "alwaysApply rule with ctx7 CLI instructions (no skill, no MCP)",
    },
}


def setup_mode(mode: str):
    """Configure environment for the given test mode."""
    if mode not in MODE_CONFIGS:
        raise ValueError(f"Unknown mode: {mode}. Available: {', '.join(MODE_CONFIGS)}")

    cfg = MODE_CONFIGS[mode]

    # 1. Always start clean
    _disable_all()

    # 2. Enable what's needed
    if cfg["mcp"]:
        _enable_mcp()
    if cfg["rule"]:
        _enable_rule(cfg["rule_content"])
    if cfg["skill"]:
        _enable_skill()
    if cfg["claude_md"]:
        _enable_claude_md(cfg["claude_md_content"])

    print(f"  Environment: {cfg['description']}")
    print(f"    MCP={cfg['mcp']}  Rule={cfg['rule']}  Skill={cfg['skill']}  CLAUDE.md={cfg['claude_md']}  Detect={cfg['detection']}")


def _disable_all():
    """Disable everything to start clean."""
    # Stop our managed MCP server
    _stop_mcp_server()
    # Kill any lingering MCP server processes (including ones spawned by ctx7 CLI)
    subprocess.run(["pkill", "-9", "-f", "context7-mcp"], capture_output=True)
    subprocess.run(["pkill", "-9", "-f", "@upstash/context7-mcp"], capture_output=True)
    subprocess.run(["pkill", "-9", "-f", "context7/packages/mcp"], capture_output=True)
    time.sleep(1)
    # MCP configs -- clear JSON and claude mcp entries
    GLOBAL_MCP_CONFIG.parent.mkdir(parents=True, exist_ok=True)
    GLOBAL_MCP_CONFIG.write_text(json.dumps(MCP_EMPTY, indent=2))
    PROJECT_MCP_CONFIG.write_text(json.dumps(MCP_EMPTY, indent=2))
    subprocess.run(["claude", "mcp", "remove", "context7", "--scope", "project"], capture_output=True)
    subprocess.run(["claude", "mcp", "remove", "context7", "--scope", "user"], capture_output=True)
    # Rule
    if RULE_FILE.exists():
        RULE_FILE.unlink()
    # Skills -- all three locations (global, project .claude, project .agents)
    for skill_path in [SKILL_DEST_GLOBAL, SKILL_DEST_PROJECT, SKILL_DEST_AGENTS]:
        if skill_path.exists() or skill_path.is_symlink():
            skill_path.unlink()
        parent = skill_path.parent
        # Remove parent dir/symlink if it exists
        if parent.is_symlink():
            parent.unlink()
        elif parent.exists():
            try:
                parent.rmdir()
            except OSError:
                pass
    # CLAUDE.md
    if CLAUDE_MD.exists():
        CLAUDE_MD.unlink()


def teardown():
    _disable_all()
    # Restore skills to their original locations
    _enable_skill()
    print("  Environment cleaned up (skills restored).")


# --- MCP server lifecycle ---

_mcp_server_process = None


def _start_mcp_server():
    """Start a single local MCP server that all workers share."""
    global _mcp_server_process
    if _mcp_server_process is not None:
        return
    # Wait for port to be free
    import socket
    for _ in range(20):
        try:
            with socket.create_connection(("localhost", MCP_LOCAL_PORT), timeout=0.5):
                # Port still in use, wait
                time.sleep(0.5)
        except (ConnectionRefusedError, OSError):
            break  # Port is free
    _mcp_server_process = subprocess.Popen(
        ["npx", "-y", "@upstash/context7-mcp@latest", "--transport", "http", "--port", str(MCP_LOCAL_PORT)],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )
    # Wait for server to be ready
    for _ in range(30):
        try:
            with socket.create_connection(("localhost", MCP_LOCAL_PORT), timeout=1):
                break
        except (ConnectionRefusedError, OSError):
            time.sleep(0.5)
    # Verify process is still alive
    if _mcp_server_process.poll() is not None:
        print(f"  WARNING: MCP server exited with code {_mcp_server_process.returncode}")
        _mcp_server_process = None
        return
    print(f"  MCP server started on port {MCP_LOCAL_PORT} (pid={_mcp_server_process.pid})")


def _stop_mcp_server():
    """Stop the local MCP server."""
    global _mcp_server_process
    if _mcp_server_process is not None:
        _mcp_server_process.kill()
        _mcp_server_process.wait()
        _mcp_server_process = None
        print(f"  MCP server stopped.")


# --- Environment helpers ---

def _enable_mcp():
    _start_mcp_server()
    # Write to both global and project config
    GLOBAL_MCP_CONFIG.write_text(json.dumps(MCP_SERVER_ENTRY, indent=2))
    PROJECT_MCP_CONFIG.write_text(json.dumps(MCP_SERVER_ENTRY, indent=2))
    # Remove first in case it already exists, then add
    subprocess.run(
        ["claude", "mcp", "remove", "context7", "--scope", "project"],
        capture_output=True,
    )
    result = subprocess.run(
        ["claude", "mcp", "add", "--scope", "project", "--transport", "http",
         "context7", f"http://localhost:{MCP_LOCAL_PORT}/mcp"],
        capture_output=True, text=True,
    )
    if result.returncode != 0:
        print(f"  WARNING: claude mcp add failed: {result.stderr.strip()}")
    # Verify
    check = subprocess.run(["claude", "mcp", "list"], capture_output=True, text=True)
    if "context7" in check.stdout:
        print(f"  MCP registered via claude mcp add")
    else:
        print(f"  WARNING: MCP not found in claude mcp list")


def _enable_rule(content: str):
    RULES_DIR.mkdir(parents=True, exist_ok=True)
    RULE_FILE.write_text(f"---\nalwaysApply: true\n---\n\n{content}")


def _enable_skill():
    # Install to all locations so Claude sees it regardless of discovery method
    for skill_path in [SKILL_DEST_GLOBAL, SKILL_DEST_PROJECT, SKILL_DEST_AGENTS]:
        parent = skill_path.parent
        # Remove broken symlinks before creating directory
        if parent.is_symlink():
            parent.unlink()
        parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(SKILL_SNAPSHOT, skill_path)


def _enable_claude_md(content: str):
    CLAUDE_MD.write_text(f"# Context7 Documentation Lookup\n\n{content}")


# --- Detection ---

def detect_trigger(mode: str, stdout: str) -> bool:
    """Check if the expected tool call was made in the stream-json output."""
    detection = MODE_CONFIGS[mode]["detection"]

    for line in stdout.split("\n"):
        line = line.strip()
        if not line:
            continue
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue

        if event.get("type") != "assistant":
            continue

        content = event.get("message", {}).get("content", [])
        for block in content:
            if block.get("type") != "tool_use":
                continue
            name = block.get("name", "")
            tool_input = block.get("input", {})

            if detection == "mcp":
                if "resolve-library-id" in name or "resolve_library_id" in name:
                    return True
                if "query-docs" in name or "query_docs" in name:
                    return True

            elif detection == "skill":
                # Skill invocation or ctx7 CLI call (skill triggers ctx7 via Bash)
                if name == "Skill":
                    # Check all input values for find-docs reference
                    input_str = json.dumps(tool_input)
                    if "find-docs" in input_str:
                        return True
                if name == "Bash":
                    command = tool_input.get("command", "")
                    if "ctx7" in command or "context7" in command:
                        return True

            elif detection == "cli":
                if name == "Bash":
                    command = tool_input.get("command", "")
                    if "ctx7" in command or "context7" in command:
                        return True

    return False


# --- Query runner ---

def run_query(query: str, mode: str, model: str, max_turns: int, timeout: int,
              context_prefix: str | None = None) -> dict:
    """Run a single query and return result dict."""
    full_query = f"{context_prefix}{query}" if context_prefix else query
    env = {k: v for k, v in os.environ.items() if k != "CLAUDECODE"}
    env["CLAUDE_CODE_DISABLE_AUTO_MEMORY"] = "1"
    cmd = [
        "claude", "-p", full_query,
        "--output-format", "stream-json",
        "--verbose",
        "--max-turns", str(max_turns),
        "--model", model,
    ]

    t0 = time.time()
    try:
        result = subprocess.run(
            cmd, capture_output=True, text=True,
            timeout=timeout, env=env,
            cwd=str(PROJECT_ROOT),
        )
        elapsed = time.time() - t0
        triggered = detect_trigger(mode, result.stdout)
        first_tool = _extract_tool_chain(result.stdout)

        return {
            "triggered": triggered,
            "first_tool": first_tool,
            "elapsed": round(elapsed, 1),
            "error": None,
        }
    except subprocess.TimeoutExpired:
        return {"triggered": False, "first_tool": None, "elapsed": timeout, "error": "timeout"}
    except Exception as e:
        return {"triggered": False, "first_tool": None, "elapsed": 0, "error": str(e)}


def _extract_tool_chain(stdout: str) -> str | None:
    """Extract a concise chain of all tool_use calls from stream output."""
    tools = []
    seen = set()
    for line in stdout.split("\n"):
        line = line.strip()
        if not line:
            continue
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        if event.get("type") != "assistant":
            continue
        for block in event.get("message", {}).get("content", []):
            if block.get("type") != "tool_use":
                continue
            name = block.get("name", "")
            inp = block.get("input", {})
            if name == "Skill":
                # Try common field names for skill identification
                skill_id = inp.get("name") or inp.get("skill") or inp.get("skill_name") or inp.get("query", "")
                if not skill_id:
                    # Fallback: search all string values for a skill name
                    for v in inp.values():
                        if isinstance(v, str) and len(v) < 100:
                            skill_id = v
                            break
                label = f"Skill({skill_id or '?'})"
            elif name == "ToolSearch":
                label = "ToolSearch"
            elif name == "Bash":
                cmd = inp.get("command", "")
                label = "Bash(ctx7)" if "ctx7" in cmd else "Bash"
            elif "resolve-library-id" in name or "resolve_library_id" in name:
                label = "MCP:resolve"
            elif "query-docs" in name or "query_docs" in name:
                label = "MCP:query"
            else:
                label = name
            # Dedupe consecutive same tool
            if label not in seen:
                tools.append(label)
                seen.add(label)
    return " -> ".join(tools) if tools else None


# --- Main ---

def run_mode(mode: str, eval_set: list, model: str, max_turns: int,
             workers: int, timeout: int, with_context: bool = False) -> dict:
    """Run all eval queries for a single mode."""
    print(f"\n{'='*60}")
    print(f"MODE: {mode}")
    print(f"{'='*60}")

    setup_mode(mode)
    time.sleep(1)

    total = len(eval_set)
    results = [None] * total

    print(f"  Running {total} queries (workers={workers}, model={model}, max_turns={max_turns})...")
    t0 = time.time()

    with ProcessPoolExecutor(max_workers=workers) as executor:
        future_to_idx = {}
        for i, item in enumerate(eval_set):
            prefix = CONTEXT_PREFIXES[i % len(CONTEXT_PREFIXES)] if with_context else None
            future = executor.submit(
                run_query, item["query"], mode, model, max_turns, timeout, prefix
            )
            future_to_idx[future] = i

        for future in as_completed(future_to_idx):
            idx = future_to_idx[future]
            item = eval_set[idx]
            res = future.result()
            triggered = res["triggered"]
            expected = item["should_trigger"]
            passed = triggered == expected
            status = "PASS" if passed else "FAIL"

            results[idx] = {
                "query": item["query"],
                "should_trigger": expected,
                "triggered": triggered,
                "pass": passed,
                "first_tool": res["first_tool"],
                "elapsed": res["elapsed"],
                "error": res["error"],
            }
            indicator = "+" if passed else "X"
            tool_info = f" [{res['first_tool']}]" if res['first_tool'] else " [no tool]"
            print(f"  [{indicator}] {idx+1}/{total} {status}{tool_info}: {item['query'][:60]}")

    elapsed = time.time() - t0

    # Compute metrics
    should_trigger = [r for r in results if r["should_trigger"]]
    should_not = [r for r in results if not r["should_trigger"]]
    true_pos = sum(1 for r in should_trigger if r["triggered"])
    false_pos = sum(1 for r in should_not if r["triggered"])
    recall = true_pos / max(1, len(should_trigger))
    precision = true_pos / max(1, true_pos + false_pos) if (true_pos + false_pos) > 0 else 0

    summary = {
        "mode": mode,
        "model": model,
        "max_turns": max_turns,
        "elapsed_seconds": round(elapsed, 1),
        "total": total,
        "passed": sum(1 for r in results if r["pass"]),
        "recall": f"{true_pos}/{len(should_trigger)} ({recall:.0%})",
        "precision": f"{true_pos}/{true_pos+false_pos} ({precision:.0%})" if (true_pos + false_pos) > 0 else "N/A",
        "false_positives": false_pos,
        "results": results,
    }

    print(f"\n  --- {mode} Summary ---")
    print(f"  Recall:    {summary['recall']}")
    print(f"  Precision: {summary['precision']}")
    print(f"  FP:        {false_pos}/{len(should_not)}")
    print(f"  Time:      {elapsed:.0f}s")

    print(f"\n  Should trigger:")
    for r in results:
        if r["should_trigger"]:
            mark = "+" if r["triggered"] else "-"
            tool = f" [{r['first_tool']}]" if r["first_tool"] else ""
            print(f"    [{mark}]{tool} {r['query'][:75]}")

    print(f"\n  Should NOT trigger:")
    for r in results:
        if not r["should_trigger"]:
            mark = "!" if r["triggered"] else "."
            tool = f" [{r['first_tool']}]" if r["first_tool"] else ""
            print(f"    [{mark}]{tool} {r['query'][:75]}")

    return summary


def write_report(all_results: dict, model: str):
    """Write a combined markdown report."""
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    ts = time.strftime("%Y%m%d-%H%M%S")
    report_path = RESULTS_DIR / f"report-{model}-{ts}.md"
    json_path = RESULTS_DIR / f"results-{model}-{ts}.json"

    with open(json_path, "w") as f:
        json.dump(all_results, f, indent=2)

    lines = [
        f"# Context7 Trigger Eval Report",
        f"",
        f"- **Model:** {model}",
        f"- **Date:** {time.strftime('%Y-%m-%d %H:%M')}",
        f"- **Eval set:** {EVAL_SET.name}",
        f"",
        f"## Summary",
        f"",
        f"| Mode | Recall | Precision | False Pos | Time |",
        f"|------|--------|-----------|-----------|------|",
    ]
    for mode_name, summary in all_results.items():
        desc = MODE_CONFIGS.get(mode_name, {}).get("description", "")
        lines.append(
            f"| {mode_name} | {summary['recall']} | {summary['precision']} "
            f"| {summary['false_positives']} | {summary['elapsed_seconds']}s |"
        )

    for mode_name, summary in all_results.items():
        desc = MODE_CONFIGS.get(mode_name, {}).get("description", "")
        lines.append(f"\n## {mode_name}")
        lines.append(f"_{desc}_\n")

        lines.append(f"### Should Trigger\n")
        lines.append(f"| # | Triggered | First Tool | Query |")
        lines.append(f"|---|-----------|------------|-------|")
        for i, r in enumerate(summary["results"]):
            if r["should_trigger"]:
                mark = "yes" if r["triggered"] else "no"
                tool = r["first_tool"] or "-"
                lines.append(f"| {i+1} | {mark} | {tool} | {r['query'][:70]} |")

        lines.append(f"\n### Should NOT Trigger\n")
        lines.append(f"| # | Triggered | First Tool | Query |")
        lines.append(f"|---|-----------|------------|-------|")
        for i, r in enumerate(summary["results"]):
            if not r["should_trigger"]:
                mark = "yes" if r["triggered"] else "no"
                tool = r["first_tool"] or "-"
                lines.append(f"| {i+1} | {mark} | {tool} | {r['query'][:70]} |")

    report_content = "\n".join(lines) + "\n"
    report_path.write_text(report_content)
    print(f"\nReport: {report_path}")
    print(f"JSON:   {json_path}")


def main():
    all_modes = ", ".join(MODE_CONFIGS.keys())
    parser = argparse.ArgumentParser(
        description="Context7 trigger eval orchestrator",
        epilog=f"Available modes: {all_modes}",
    )
    parser.add_argument("--modes", default="cli+skill,cli+claude.md,cli+rule,mcp,mcp+rule,mcp+claude.md",
                        help=f"Comma-separated modes (default: all)")
    parser.add_argument("--model", default="claude-opus-4-6")
    parser.add_argument("--workers", type=int, default=60)
    parser.add_argument("--max-turns", type=int, default=10)
    parser.add_argument("--timeout", type=int, default=120)
    parser.add_argument("--with-context", action="store_true",
                        help="Prepend realistic conversation context to queries (simulates mid-session)")
    parser.add_argument("--compare", action="store_true",
                        help="Run each mode twice (clean + with-context) and show side-by-side comparison")
    args = parser.parse_args()

    modes = [m.strip() for m in args.modes.split(",")]

    with open(EVAL_SET) as f:
        eval_set = json.load(f)

    print(f"Context7 Trigger Eval Orchestrator")
    print(f"Modes:     {', '.join(modes)}")
    print(f"Model:     {args.model}")
    print(f"Queries:   {len(eval_set)}")
    print(f"Workers:   {args.workers}")
    print(f"Max turns: {args.max_turns}")
    if args.compare:
        print(f"Compare:   ON (clean vs mid-session for each mode)")
    else:
        print(f"Context:   {'ON (mid-session simulation)' if args.with_context else 'OFF (clean queries)'}")
    print(f"\nAvailable modes:")
    for name, cfg in MODE_CONFIGS.items():
        marker = "*" if name in modes else " "
        print(f"  [{marker}] {name:<18} {cfg['description']}")

    all_results = {}
    try:
        if args.compare:
            # Run each mode twice: clean then with-context
            for mode in modes:
                clean_key = f"{mode}"
                ctx_key = f"{mode} (ctx)"
                summary_clean = run_mode(mode, eval_set, args.model, args.max_turns,
                                        args.workers, args.timeout, False)
                all_results[clean_key] = summary_clean
                summary_ctx = run_mode(mode, eval_set, args.model, args.max_turns,
                                       args.workers, args.timeout, True)
                all_results[ctx_key] = summary_ctx
        else:
            for mode in modes:
                summary = run_mode(mode, eval_set, args.model, args.max_turns,
                                 args.workers, args.timeout, args.with_context)
                all_results[mode] = summary
    finally:
        teardown()

    write_report(all_results, args.model)

    # Final comparison
    print(f"\n{'='*85}")
    print(f"FINAL COMPARISON")
    print(f"{'='*85}")
    if args.compare:
        print(f"{'Mode':<22} {'Recall (clean)':<18} {'Recall (ctx)':<18} {'Delta':<10} {'FP':<5}")
        print(f"{'-'*85}")
        for mode in modes:
            clean = all_results.get(mode, {})
            ctx = all_results.get(f"{mode} (ctx)", {})
            c_recall = clean.get("recall", "N/A")
            x_recall = ctx.get("recall", "N/A")
            # Extract numeric recall for delta
            c_results = clean.get("results", [])
            x_results = ctx.get("results", [])
            c_tp = sum(1 for r in c_results if r.get("should_trigger") and r.get("triggered"))
            x_tp = sum(1 for r in x_results if r.get("should_trigger") and r.get("triggered"))
            c_total = sum(1 for r in c_results if r.get("should_trigger"))
            x_total = sum(1 for r in x_results if r.get("should_trigger"))
            if c_total > 0 and x_total > 0:
                delta_pct = round((x_tp / x_total - c_tp / c_total) * 100)
                delta_str = f"{delta_pct:+d}%"
            else:
                delta_str = "N/A"
            fp = clean.get("false_positives", 0)
            print(f"{mode:<22} {c_recall:<18} {x_recall:<18} {delta_str:<10} {fp:<5}")
    else:
        print(f"{'Mode':<20} {'Recall':<20} {'Precision':<20} {'FP':<5}")
        print(f"{'-'*70}")
        for mode_name, s in all_results.items():
            print(f"{mode_name:<20} {s['recall']:<20} {s['precision']:<20} {s['false_positives']:<5}")


if __name__ == "__main__":
    main()
