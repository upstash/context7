#!/usr/bin/env python3
"""Test whether Context7 MCP tools trigger for eval queries (with rule installed).
Runs queries in parallel for speed."""

import json
import os
import subprocess
import sys
import time
from concurrent.futures import ProcessPoolExecutor, as_completed


def test_query(query, model, max_turns=4, timeout=90):
    """Run a single query and check if MCP tools were called."""
    env = {k: v for k, v in os.environ.items() if k != "CLAUDECODE"}
    cmd = [
        "claude", "-p", query,
        "--output-format", "stream-json",
        "--verbose",
        "--max-turns", str(max_turns),
        "--model", model,
    ]
    try:
        result = subprocess.run(
            cmd, capture_output=True, text=True,
            timeout=timeout, env=env,
            cwd="/Users/fahreddinozcan/Desktop/repos/context7"
        )
        output = result.stdout + result.stderr
        # Only check for actual tool_use invocations, not the init tools list
        for line in output.split("\n"):
            if not line.strip():
                continue
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                continue
            if event.get("type") == "assistant":
                content = event.get("message", {}).get("content", [])
                for block in content:
                    if block.get("type") == "tool_use":
                        name = block.get("name", "")
                        if "resolve-library-id" in name or "query-docs" in name or "resolve_library_id" in name:
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
    max_workers = int(sys.argv[3]) if len(sys.argv) > 3 else 10

    with open(eval_set_path) as f:
        eval_set = json.load(f)

    total = len(eval_set)
    results = [None] * total

    print(f"Running {total} queries in parallel (workers={max_workers}, model={model})...")
    t0 = time.time()

    with ProcessPoolExecutor(max_workers=max_workers) as executor:
        future_to_idx = {}
        for i, item in enumerate(eval_set):
            future = executor.submit(test_query, item["query"], model)
            future_to_idx[future] = i

        for future in as_completed(future_to_idx):
            idx = future_to_idx[future]
            item = eval_set[idx]
            triggered = future.result()
            passed = (triggered == item["should_trigger"])
            status = "PASS" if passed else "FAIL"

            results[idx] = {
                "query": item["query"],
                "should_trigger": item["should_trigger"],
                "triggered": triggered,
                "pass": passed,
            }
            print(f"  [{idx+1}/{total}] [{status}] triggered={triggered} expected={item['should_trigger']}: {item['query'][:65]}")

    elapsed = time.time() - t0

    # Summary
    n_passed = sum(1 for r in results if r["pass"])
    should_trigger_items = [r for r in results if r["should_trigger"]]
    actually_triggered = sum(1 for r in should_trigger_items if r["triggered"])
    should_not_items = [r for r in results if not r["should_trigger"]]
    false_triggers = sum(1 for r in should_not_items if r["triggered"])

    print(f"\n=== MCP + Rule Trigger Results (model: {model}, {elapsed:.0f}s) ===")
    print(f"Total: {total}  Passed: {n_passed}  Failed: {total - n_passed}")
    print(f"Recall: {actually_triggered}/{len(should_trigger_items)} ({100*actually_triggered/max(1,len(should_trigger_items)):.0f}%)")
    if actually_triggered + false_triggers > 0:
        print(f"Precision: {actually_triggered}/{actually_triggered+false_triggers} ({100*actually_triggered/max(1,actually_triggered+false_triggers):.0f}%)")
    else:
        print("Precision: N/A (no triggers)")
    print(f"False triggers: {false_triggers}/{len(should_not_items)}")

    # Per-query breakdown
    print(f"\n--- Should Trigger ---")
    for r in results:
        if r["should_trigger"]:
            mark = "+" if r["triggered"] else "-"
            print(f"  [{mark}] {r['query'][:80]}")
    print(f"\n--- Should NOT Trigger ---")
    for r in results:
        if not r["should_trigger"]:
            mark = "!" if r["triggered"] else "."
            print(f"  [{mark}] {r['query'][:80]}")

    out_path = f"/Users/fahreddinozcan/Desktop/repos/context7/skills/find-docs-workspace/mcp-rule-{model}-results.json"
    with open(out_path, "w") as f:
        json.dump({"model": model, "mode": "mcp+rule", "elapsed_seconds": elapsed, "results": results}, f, indent=2)
    print(f"\nResults saved to {out_path}")


if __name__ == "__main__":
    main()
