#!/usr/bin/env python3
"""Orchestrator: tests MCP-only, MCP+rule, and skill-only trigger behavior.

For each mode, arranges the environment (MCP config, rule, skill), runs eval
queries via `claude -p`, and checks whether the expected initial tool call
was made.

Usage:
    python orchestrator.py [--modes mcp,mcp+rule,skill] [--model claude-sonnet-4-6] [--workers 8] [--max-turns 4]
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
MCP_CONFIG = CLAUDE_DIR / ".mcp.json"

# Backup / source files
RULE_SELECTIVE = RULES_DIR / "_context7.md.disabled"
RULE_ACTIVE = RULES_DIR / "context7.md"
SKILL_DEST = SKILLS_DIR / "find-docs" / "SKILL.md"

# MCP server config for context7
MCP_SERVER_ENTRY = {
    "mcpServers": {
        "context7": {
            "command": "npx",
            "args": ["-y", "@upstash/context7-mcp@latest"]
        }
    }
}
MCP_EMPTY = {"mcpServers": {}}


def setup_mode(mode: str):
    """Configure environment for the given test mode."""
    # 1. Always start clean
    _disable_rule()
    _disable_skill()
    _disable_mcp()

    if mode == "mcp":
        _enable_mcp()
    elif mode == "mcp+rule":
        _enable_mcp()
        _enable_rule()
    elif mode == "skill":
        _enable_skill()
    else:
        raise ValueError(f"Unknown mode: {mode}")

    print(f"  Environment configured for mode: {mode}")
    print(f"    MCP:   {'ON' if mode in ('mcp', 'mcp+rule') else 'OFF'}")
    print(f"    Rule:  {'ON' if mode == 'mcp+rule' else 'OFF'}")
    print(f"    Skill: {'ON' if mode == 'skill' else 'OFF'}")


def teardown():
    """Restore everything to disabled state."""
    _disable_rule()
    _disable_skill()
    _disable_mcp()
    print("  Environment cleaned up.")


# --- Environment helpers ---

def _enable_mcp():
    MCP_CONFIG.parent.mkdir(parents=True, exist_ok=True)
    MCP_CONFIG.write_text(json.dumps(MCP_SERVER_ENTRY, indent=2))


def _disable_mcp():
    MCP_CONFIG.parent.mkdir(parents=True, exist_ok=True)
    MCP_CONFIG.write_text(json.dumps(MCP_EMPTY, indent=2))


def _enable_rule():
    if RULE_SELECTIVE.exists():
        shutil.copy2(RULE_SELECTIVE, RULE_ACTIVE)
    elif not RULE_ACTIVE.exists():
        # Write a default selective rule
        RULE_ACTIVE.write_text(
            "---\nalwaysApply: true\n---\n\n"
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


def _disable_rule():
    if RULE_ACTIVE.exists():
        RULE_ACTIVE.unlink()


def _enable_skill():
    SKILL_DEST.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(SKILL_SNAPSHOT, SKILL_DEST)


def _disable_skill():
    if SKILL_DEST.exists():
        SKILL_DEST.unlink()
    # Also remove the directory if empty
    if SKILL_DEST.parent.exists():
        try:
            SKILL_DEST.parent.rmdir()
        except OSError:
            pass


# --- Detection ---

def detect_trigger(mode: str, stdout: str) -> bool:
    """Check if the expected tool call was made in the stream-json output.

    For MCP modes: look for resolve-library-id or query-docs tool_use.
    For skill mode: look for Skill tool_use referencing find-docs.
    """
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

            if mode in ("mcp", "mcp+rule"):
                # Check for MCP tool calls
                if "resolve-library-id" in name or "resolve_library_id" in name:
                    return True
                if "query-docs" in name or "query_docs" in name:
                    return True
            elif mode == "skill":
                # Check for Skill tool invocation with find-docs
                if name == "Skill":
                    skill_name = tool_input.get("skill", "")
                    if "find-docs" in skill_name:
                        return True
                # Also check ToolSearch for find-docs (indicates intent)
                if name == "ToolSearch":
                    query = tool_input.get("query", "")
                    if "find-docs" in query or "context7" in query.lower():
                        return True

    return False


# --- Query runner ---

def run_query(query: str, mode: str, model: str, max_turns: int, timeout: int) -> dict:
    """Run a single query and return result dict."""
    env = {k: v for k, v in os.environ.items() if k != "CLAUDECODE"}
    env["CLAUDE_CODE_DISABLE_AUTO_MEMORY"] = "1"
    cmd = [
        "claude", "-p", query,
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

        # Extract first tool call for logging
        first_tool = _extract_first_tool(result.stdout)

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


def _extract_first_tool(stdout: str) -> str | None:
    """Extract the name of the first tool_use from stream output."""
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
            if block.get("type") == "tool_use":
                name = block.get("name", "")
                inp = block.get("input", {})
                # Add detail for Skill/ToolSearch
                if name == "Skill":
                    return f"Skill({inp.get('skill', '?')})"
                if name == "ToolSearch":
                    return f"ToolSearch({inp.get('query', '?')[:40]})"
                return name
    return None


# --- Main ---

def run_mode(mode: str, eval_set: list, model: str, max_turns: int,
             workers: int, timeout: int) -> dict:
    """Run all eval queries for a single mode."""
    print(f"\n{'='*60}")
    print(f"MODE: {mode}")
    print(f"{'='*60}")

    setup_mode(mode)
    time.sleep(1)  # Brief pause for config to settle

    total = len(eval_set)
    results = [None] * total

    print(f"  Running {total} queries (workers={workers}, model={model}, max_turns={max_turns})...")
    t0 = time.time()

    with ProcessPoolExecutor(max_workers=workers) as executor:
        future_to_idx = {}
        for i, item in enumerate(eval_set):
            future = executor.submit(
                run_query, item["query"], mode, model, max_turns, timeout
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

    # Print summary
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

    # Save raw JSON
    with open(json_path, "w") as f:
        json.dump(all_results, f, indent=2)

    # Build markdown
    lines = [
        f"# Trigger Eval Report",
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
        lines.append(
            f"| {mode_name} | {summary['recall']} | {summary['precision']} "
            f"| {summary['false_positives']} | {summary['elapsed_seconds']}s |"
        )

    for mode_name, summary in all_results.items():
        lines.append(f"\n## {mode_name}")
        lines.append(f"\n### Should Trigger\n")
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
    parser = argparse.ArgumentParser(description="Context7 trigger eval orchestrator")
    parser.add_argument("--modes", default="mcp,mcp+rule,skill",
                        help="Comma-separated modes to test (default: mcp,mcp+rule,skill)")
    parser.add_argument("--model", default="claude-opus-4-6",
                        help="Model to use (default: claude-opus-4-6)")
    parser.add_argument("--workers", type=int, default=20,
                        help="Parallel workers (default: 20)")
    parser.add_argument("--max-turns", type=int, default=4,
                        help="Max turns per query (default: 4)")
    parser.add_argument("--timeout", type=int, default=120,
                        help="Timeout per query in seconds (default: 120)")
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

    all_results = {}
    try:
        for mode in modes:
            summary = run_mode(mode, eval_set, args.model, args.max_turns,
                             args.workers, args.timeout)
            all_results[mode] = summary
    finally:
        # Always clean up
        teardown()

    write_report(all_results, args.model)

    # Final comparison
    print(f"\n{'='*60}")
    print(f"FINAL COMPARISON")
    print(f"{'='*60}")
    print(f"{'Mode':<15} {'Recall':<20} {'Precision':<20} {'FP':<5}")
    print(f"{'-'*60}")
    for mode_name, s in all_results.items():
        print(f"{mode_name:<15} {s['recall']:<20} {s['precision']:<20} {s['false_positives']:<5}")


if __name__ == "__main__":
    main()
