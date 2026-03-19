#!/usr/bin/env python3
"""Test whether Context7 MCP tools trigger for eval queries."""

import json
import os
import subprocess
import sys
import time

def test_query(query, model, timeout=30):
    """Run a single query and check if MCP tools were called."""
    env = {k: v for k, v in os.environ.items() if k != "CLAUDECODE"}
    cmd = [
        "claude", "-p", query,
        "--output-format", "stream-json",
        "--max-turns", "1",
        "--model", model,
    ]
    try:
        result = subprocess.run(
            cmd, capture_output=True, text=True,
            timeout=timeout, env=env,
            cwd="/Users/fahreddinozcan/Desktop/repos/context7"
        )
        output = result.stdout
        # Check for MCP tool invocations
        mcp_keywords = ["resolve-library-id", "query-docs", "resolve_library_id", "query_docs"]
        for kw in mcp_keywords:
            if kw in output:
                return True
        return False
    except subprocess.TimeoutExpired:
        return False
    except Exception as e:
        print(f"  Error: {e}", file=sys.stderr)
        return False

def main():
    eval_set_path = sys.argv[1]
    model = sys.argv[2] if len(sys.argv) > 2 else "claude-sonnet-4-6"

    with open(eval_set_path) as f:
        eval_set = json.load(f)

    results = []
    total = len(eval_set)

    for i, item in enumerate(eval_set, 1):
        query = item["query"]
        should_trigger = item["should_trigger"]
        print(f"[{i}/{total}] {query[:65]}...")

        triggered = test_query(query, model)
        passed = (triggered == should_trigger)
        status = "PASS" if passed else "FAIL"

        print(f"  -> triggered={triggered} expected={should_trigger} [{status}]")

        results.append({
            "query": query,
            "should_trigger": should_trigger,
            "triggered": triggered,
            "pass": passed,
        })

    # Summary
    n_passed = sum(1 for r in results if r["pass"])
    should_trigger_items = [r for r in results if r["should_trigger"]]
    actually_triggered = sum(1 for r in should_trigger_items if r["triggered"])
    should_not_items = [r for r in results if not r["should_trigger"]]
    false_triggers = sum(1 for r in should_not_items if r["triggered"])

    print(f"\n=== MCP Trigger Results (model: {model}) ===")
    print(f"Total: {total}  Passed: {n_passed}  Failed: {total - n_passed}")
    print(f"Recall: {actually_triggered}/{len(should_trigger_items)} ({100*actually_triggered/max(1,len(should_trigger_items)):.0f}%)")
    print(f"False triggers: {false_triggers}/{len(should_not_items)}")

    out_path = "/Users/fahreddinozcan/Desktop/repos/context7/skills/find-docs-workspace/mcp-trigger-results.json"
    with open(out_path, "w") as f:
        json.dump({"model": model, "results": results}, f, indent=2)
    print(f"Results saved to {out_path}")

if __name__ == "__main__":
    main()
