#!/usr/bin/env python3
"""Run the same Context7 trigger cases and checks with Claude Code or Codex."""
import argparse
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import uuid

TOOLS = {"resolve-library-id": "resolve", "query-docs": "query"}
CLAUDE_TOOLS = {f"mcp__context7__{name}": kind for name, kind in TOOLS.items()}


def parse(events, agent):
    calls, answer, session, complete, failed = [], "", None, False, False
    tool_errors = 0
    claude_call_ids = set()
    for event in events:
        kind = event.get("type")
        if agent == "codex":
            if kind == "thread.started":
                session = event["thread_id"]
            if kind == "turn.completed":
                complete = True
            if kind == "turn.failed":
                failed = True
            if kind != "item.completed":
                continue
            item = event["item"]
            if item["type"] == "agent_message":
                answer = item["text"]
            if item["type"] == "mcp_tool_call" and item["server"] == "context7":
                name = TOOLS.get(item["tool"])
                if name:
                    calls.append((name, item.get("arguments")))
                    tool_errors += bool(item.get("error") or (item.get("result") or {}).get("isError"))
        else:
            if kind == "system" and event.get("subtype") == "init":
                session = event["session_id"]
                failed |= not any(
                    server["name"] == "context7" and server["status"] == "connected"
                    for server in event.get("mcp_servers", [])
                )
            if kind == "result":
                answer = event.get("result") or ""
                complete = not event.get("is_error")
            if kind == "assistant":
                for block in event["message"]["content"]:
                    name = CLAUDE_TOOLS.get(block.get("name"))
                    if block["type"] == "tool_use" and name:
                        calls.append((name, block.get("input")))
                        claude_call_ids.add(block["id"])
            if kind == "user":
                for block in event["message"].get("content", []):
                    if isinstance(block, dict) and block.get("tool_use_id") in claude_call_ids:
                        tool_errors += bool(block.get("is_error"))
    return calls, answer, session, complete and not failed, tool_errors


def checks(case, calls, answer):
    issues = []
    arguments = json.dumps(calls).lower()
    if any(s.lower() in arguments for s in case.get("must_not_send", [])):
        issues.append("sent-sensitive-input")
    names = [name for name, _ in calls]
    if case.get("skip_resolve") and names[:1] == ["resolve"]:
        issues.append("resolve-not-skipped")
    if any(count > 3 for count in Counter(names).values()):
        issues.append("over-3-calls")
    if len(calls) > case.get("max_calls", float("inf")):
        issues.append("over-max-calls")
    if case.get("needs_answer") and len(answer.strip()) < 40:
        issues.append("no-answer")
    return issues


def run_turn(args, env, config, prompt, session=None, followup=False):
    if args.agent == "codex":
        cmd = [args.binary, "exec"]
        if followup:
            cmd += ["resume", session]
        cmd += ["--json", "--skip-git-repo-check", "--model", args.model]
        if not (session or followup):
            cmd += ["--ephemeral"]
        cmd += ["--", prompt]
    else:
        cmd = [args.binary, "-p", "--output-format", "stream-json", "--verbose",
               "--max-turns", "10", "--model", args.model, "--setting-sources", "project",
               "--strict-mcp-config", "--mcp-config", str(config),
               "--allowedTools", ",".join(CLAUDE_TOOLS)]
        if followup:
            cmd += ["--resume", session]
        elif session:
            cmd += ["--session-id", session]
        else:
            cmd += ["--no-session-persistence"]
        cmd += ["--", prompt]
    try:
        proc = subprocess.run(cmd, cwd=args.project, env=env, stdin=subprocess.DEVNULL,
                              capture_output=True, text=True, timeout=args.timeout)
    except subprocess.TimeoutExpired:
        return [], "", None, "timeout", 0
    events = []
    for line in proc.stdout.splitlines():
        try:
            events.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    calls, answer, thread, complete, tool_errors = parse(events, args.agent)
    error = f"exit {proc.returncode}" if proc.returncode else None if complete else "incomplete turn"
    return calls, answer, thread, error, tool_errors


def run_case(args, env, config, case):
    followup = case.get("followup")
    session = str(uuid.uuid4()) if followup else None
    calls, answer, thread, error, tool_errors = run_turn(args, env, config, case["query"], session)
    first_calls = None
    if followup and not error:
        first_calls = [name for name, _ in calls]
        if thread:
            calls, answer, _, error, followup_errors = run_turn(
                args, env, config, followup, thread, followup=True
            )
            tool_errors += followup_errors
        else:
            error = "missing session ID"
    return {
        "set": case["set"],
        "category": case["category"],
        "expected": case["should_trigger"],
        "calls": [name for name, _ in calls],
        "first_calls": first_calls,
        "checks_failed": checks(case, calls, answer) if not error else [],
        "tool_errors": tool_errors,
        "error": error,
    }


def configure(args, scratch):
    env = os.environ.copy()
    env.pop("CLAUDECODE", None)
    # The client needs the header, but subprocesses launched by Codex do not.
    key = env.pop("CONTEXT7_API_KEY", None)
    headers = {"X-Context7-API-Key": key} if key else {}
    if args.agent == "claude":
        env["CLAUDE_CODE_DISABLE_AUTO_MEMORY"] = "1"
        config = scratch / "mcp.json"
        config.write_text(json.dumps({"mcpServers": {"context7": {
            "type": "http", "url": args.url, "headers": headers
        }}}))
        return env, config

    source = Path(env.get("CODEX_HOME", Path.home() / ".codex"))
    codex_home = scratch / "codex"
    codex_home.mkdir()
    for filename in ("auth.json", "models_cache.json"):
        if (source / filename).is_file():
            shutil.copyfile(source / filename, codex_home / filename)
    home = scratch / "home"
    home.mkdir()
    env.update(HOME=str(home), CODEX_HOME=str(codex_home), XDG_CONFIG_HOME=str(home),
               XDG_DATA_HOME=str(home), XDG_CACHE_HOME=str(home))
    config = codex_home / "config.toml"
    config.write_text(
        'approval_policy = "never"\nsandbox_mode = "read-only"\n'
        f'model_reasoning_effort = {json.dumps(args.reasoning_effort)}\n'
        f'[projects.{json.dumps(str(args.project))}]\ntrust_level = "trusted"\n'
        f'[mcp_servers.context7]\nurl = {json.dumps(args.url)}\nrequired = true\n'
        + ('[mcp_servers.context7.http_headers]\n'
           f'"X-Context7-API-Key" = {json.dumps(key)}\n' if key else "")
        + '[features]\napps = false\nplugins = false\nmemories = false\n'
    )
    return env, config


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--agent", required=True, choices=["claude", "codex"])
    parser.add_argument("--binary", help="Client binary path, defaults to the agent name")
    parser.add_argument("--model", required=True)
    parser.add_argument("--reasoning-effort", default="low", help="Codex reasoning effort")
    parser.add_argument("--project", required=True, type=Path, help="Neutral fixture directory")
    parser.add_argument("--url", required=True, help="Context7 HTTP MCP endpoint")
    parser.add_argument("--eval", required=True, type=Path, action="append")
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument("--timeout", type=int, default=240, help="Seconds per turn")
    args = parser.parse_args()
    args.binary = args.binary or args.agent
    args.project = args.project.resolve(strict=True)
    cases = []
    for path in args.eval:
        for index, case in enumerate(json.loads(path.read_text()), 1):
            cases.append({"set": path.stem.removeprefix("trigger-eval-"), **case, "index": index})
    results = [None] * len(cases)
    os.umask(0o077)
    with tempfile.TemporaryDirectory(prefix="trigger-eval-") as directory:
        env, config = configure(args, Path(directory))
        version = subprocess.check_output([args.binary, "--version"], env=env, text=True).strip()
        with ThreadPoolExecutor(max_workers=args.workers) as pool:
            pending = {pool.submit(run_case, args, env, config, case): i for i, case in enumerate(cases)}
            for job in as_completed(pending):
                i = pending[job]
                result = job.result()
                result["index"] = cases[i]["index"]
                results[i] = result
                print(result["set"], result["index"], result["error"] or result["calls"], flush=True)
    summary = {}
    for name in dict.fromkeys(row["set"] for row in results):
        rows = [row for row in results if row["set"] == name]
        valid = [row for row in rows if not row["error"]]
        pos = [row for row in valid if row["expected"] is True]
        neg = [row for row in valid if row["expected"] is False]
        summary[name] = {
            "recall": f"{sum(bool(row['calls']) for row in pos)}/{len(pos)}",
            "false_positives": f"{sum(bool(row['calls']) for row in neg)}/{len(neg)}",
            "checks_failed": sum(bool(row["checks_failed"]) for row in valid),
            "tool_errors": sum(row["tool_errors"] for row in valid),
            "followups_without_prior_query": sum(
                row["first_calls"] is not None and "query" not in row["first_calls"] for row in valid
            ),
            "client_errors": len(rows) - len(valid),
        }
    args.output.write_text(json.dumps({
        "agent": args.agent, "version": version, "model": args.model,
        "reasoning_effort": args.reasoning_effort if args.agent == "codex" else None,
        "summary": summary, "results": results,
    }, indent=2) + "\n")
    print(json.dumps(summary, indent=2))
    return int(any(row["error"] for row in results))


if __name__ == "__main__":
    raise SystemExit(main())
