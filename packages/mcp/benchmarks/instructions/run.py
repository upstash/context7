#!/usr/bin/env python3
"""Run the same Context7 trigger cases and checks with Claude Code or Codex."""
import argparse
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile
import urllib.error
import urllib.request
import uuid

TOOLS = {"resolve-library-id": "resolve", "query-docs": "query"}
CLAUDE_TOOLS = {f"mcp__context7__{name}": kind for name, kind in TOOLS.items()}
# The runner archives this commit as the fixture, so every run sees the same files.
FIXTURE_REV = "a5175f3e91cbfce1275d65dae9aa4676911d999e"
# Agents load these paths as instructions, skills, or MCP configuration.
AGENT_PATHS = (".agents", ".claude", ".codex", ".cursor", ".mcp.json", ".opencode", ".pi",
               "AGENTS.md", "CLAUDE.md", "GEMINI.md", "rules")
# The repository cases name these files.
FIXTURE_FILES = ("README.md", "package.json", "eslint.config.js", "packages/cli/package.json",
                 "packages/cli/src/index.ts", "packages/mcp/package.json",
                 "packages/mcp/src/index.ts", "packages/sdk/src/client.ts",
                 "packages/tools-ai-sdk/package.json")


def parse(events, agent):
    calls, answer, session, complete, failed = [], "", None, False, False
    tool_errors = web_searches = 0
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
            if item["type"] == "web_search":
                web_searches += 1
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
    return calls, answer, session, complete and not failed, tool_errors, web_searches


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


def run_turn(args, env, config, prompt, session=None, followup=False, *, max_turns=10, extra_tools=()):
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
               "--max-turns", str(max_turns), "--model", args.model, "--setting-sources", "project",
               "--strict-mcp-config", "--mcp-config", str(config),
               "--allowedTools", ",".join((*CLAUDE_TOOLS, *extra_tools))]
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
        return [], "", None, "timeout", 0, 0
    events = []
    for line in proc.stdout.splitlines():
        try:
            events.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    calls, answer, thread, complete, tool_errors, web_searches = parse(events, args.agent)
    error = f"exit {proc.returncode}" if proc.returncode else None if complete else "incomplete turn"
    return calls, answer, thread, error, tool_errors, web_searches


def run_case(args, env, config, case):
    followup = case.get("followup")
    session = str(uuid.uuid4()) if followup else None
    calls, answer, thread, error, tool_errors, web_searches = run_turn(
        args, env, config, case["query"], session
    )
    first_calls = None
    if followup and not error:
        first_calls = [name for name, _ in calls]
        if thread:
            calls, answer, _, error, followup_errors, web_searches = run_turn(
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
        "web_searches": web_searches if args.agent == "codex" else None,
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
    web_search = (
        f'web_search = {json.dumps(args.codex_web_search)}\n' if args.codex_web_search else ""
    )
    mcp_exposure = 'omit_tools_from = ["deferred", "code_mode"]\n' if args.codex_mcp_direct else ""
    config.write_text(
        web_search
        + 'approval_policy = "never"\nsandbox_mode = "read-only"\n'
        f'model_reasoning_effort = {json.dumps(args.reasoning_effort)}\n'
        f'[projects.{json.dumps(str(args.project))}]\ntrust_level = "trusted"\n'
        f'[mcp_servers.context7]\nurl = {json.dumps(args.url)}\nrequired = true\n'
        + mcp_exposure
        + ('[mcp_servers.context7.http_headers]\n'
           f'"X-Context7-API-Key" = {json.dumps(key)}\n' if key else "")
        + '[features]\napps = false\nplugins = false\nmemories = false\n'
    )
    return env, config


def git(*command):
    try:
        return subprocess.run(["git", "-C", str(Path(__file__).resolve().parent), *command],
                              check=True, capture_output=True).stdout
    except (OSError, subprocess.CalledProcessError):
        return None


def build_fixture(rev, directory, project_files):
    """Extract the pinned commit without the paths that agents load on their own."""
    top = (git("rev-parse", "--show-toplevel") or b"").decode().strip()
    archive = top and git("-C", top, "archive", "--format=tar", rev)
    if not archive:
        raise SystemExit(f"Cannot archive fixture revision {rev}. Fetch it, or pass --project.")
    project = directory / "project"
    project.mkdir()
    with tarfile.open(fileobj=io.BytesIO(archive)) as tar:
        tar.extractall(project, **({"filter": "data"} if hasattr(tarfile, "data_filter") else {}))
    for name in AGENT_PATHS:
        path = project / name
        if path.is_dir():
            shutil.rmtree(path)
        elif path.exists():
            path.unlink()
    for name, source in project_files:
        target = project / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)
    return project


def check_fixture(project):
    """Return the reason this directory cannot be a fixture, or None."""
    if "context7" in str(project).lower():
        return "its path contains 'context7', which biases tool selection"
    missing = [name for name in FIXTURE_FILES if not (project / name).is_file()]
    if missing:
        return "it lacks files that the cases name: " + ", ".join(missing)
    return None


def fixture_digest(project):
    digest, count = hashlib.sha256(), 0
    for path in sorted(project.rglob("*")):
        relative = path.relative_to(project)
        if path.is_file() and not {".git", "node_modules"} & set(relative.parts):
            digest.update(str(relative).encode() + b"\0" + hashlib.sha256(path.read_bytes()).digest())
            count += 1
    return count, digest.hexdigest()


def describe_server(url, key):
    """Record what the endpoint serves, so a result names the text it measured."""
    headers = {"Content-Type": "application/json", "Accept": "application/json, text/event-stream",
               "MCP-Protocol-Version": "2025-06-18"}
    if key:
        headers["X-Context7-API-Key"] = key

    def call(method, params):
        body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
        with urllib.request.urlopen(urllib.request.Request(url, body, headers), timeout=30) as response:
            text = response.read().decode()
        for line in [text, *text.splitlines()]:
            try:
                message = json.loads(line.removeprefix("data:"))
            except json.JSONDecodeError:
                continue
            if isinstance(message, dict) and "result" in message:
                return message["result"]
        raise ValueError(f"no result for {method}")

    try:
        init = call("initialize", {"protocolVersion": "2025-06-18", "capabilities": {},
                                   "clientInfo": {"name": "trigger-eval", "version": "1"}})
    except (OSError, ValueError) as error:
        raise SystemExit(f"The MCP endpoint {url} did not answer initialize: {error}")
    instructions = init.get("instructions") or ""
    server = {
        **{name: (init.get("serverInfo") or {}).get(name) for name in ("name", "version")},
        "instructions_chars": len(instructions),
        "instructions_sha256": hashlib.sha256(instructions.encode()).hexdigest(),
    }
    try:
        server["tools"] = [{
            "name": tool.get("name"),
            "description_chars": len(tool.get("description") or ""),
            "always_load": bool((tool.get("_meta") or {}).get("anthropic/alwaysLoad")),
        } for tool in call("tools/list", {})["tools"]]
    except (OSError, ValueError, KeyError) as error:
        server["tools_error"] = str(error)
    return server


def summarize(rows, agent, repeats):
    valid = [row for row in rows if not row["error"]]

    def rate(expected, subset):
        subset = [row for row in subset if row["expected"] is expected]
        return f"{sum(bool(row['calls']) for row in subset)}/{len(subset)}"

    outcomes = {}
    for row in valid:
        outcomes.setdefault(row["index"], set()).add(bool(row["calls"]))
    rounds = [[row for row in valid if row["repeat"] == repeat] for repeat in range(1, repeats + 1)]
    summary = {
        "recall": rate(True, valid),
        "false_positives": rate(False, valid),
        "recall_by_repeat": [rate(True, subset) for subset in rounds],
        "false_positives_by_repeat": [rate(False, subset) for subset in rounds],
        # Cases whose completed repeats disagree on whether to call Context7.
        "unstable_cases": sum(len(seen) > 1 for seen in outcomes.values()),
        "checks_failed": sum(bool(row["checks_failed"]) for row in valid),
        "tool_errors": sum(row["tool_errors"] for row in valid),
        "followups_without_prior_query": sum(
            row["first_calls"] is not None and "query" not in row["first_calls"] for row in valid
        ),
        "client_errors": len(rows) - len(valid),
    }
    if agent == "codex":
        summary["cases_with_web_search"] = sum(bool(row["web_searches"]) for row in valid)
    return summary


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--agent", required=True, choices=["claude", "codex"])
    parser.add_argument("--binary", help="Client binary path, defaults to the agent name")
    parser.add_argument("--model", required=True)
    parser.add_argument("--reasoning-effort", default="low", help="Codex reasoning effort")
    parser.add_argument("--codex-web-search", choices=["cached", "live", "disabled"],
                        help="Override Codex web search mode for a separate diagnostic run")
    parser.add_argument("--codex-mcp-direct", action="store_true",
                        help="Expose Context7 in Codex's initial tool list")
    parser.add_argument("--project", type=Path,
                        help="Use this fixture directory as it is, in place of the pinned commit")
    parser.add_argument("--fixture-rev", default=FIXTURE_REV,
                        help="Commit that the runner archives as the fixture")
    parser.add_argument("--project-file", action="append", default=[], metavar="NAME=PATH",
                        help="Copy a file into the archived fixture, for example AGENTS.md=rule.md")
    parser.add_argument("--url", required=True, help="Context7 HTTP MCP endpoint")
    parser.add_argument("--eval", required=True, type=Path, action="append")
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--label", help="Name of the variant under test, stored in the report")
    parser.add_argument("--repeats", type=int, default=3, help="Runs per case")
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument("--timeout", type=int, default=240, help="Seconds per turn")
    args = parser.parse_args()
    if args.codex_web_search and args.agent != "codex":
        parser.error("--codex-web-search requires --agent codex")
    if args.codex_mcp_direct and args.agent != "codex":
        parser.error("--codex-mcp-direct requires --agent codex")
    if args.repeats < 1:
        parser.error("--repeats must be 1 or more")
    if args.project and args.project_file:
        parser.error("--project-file needs the archived fixture. Remove --project.")
    project_files = []
    for item in args.project_file:
        name, _, source = item.partition("=")
        if not name or Path(name).is_absolute() or ".." in Path(name).parts or not Path(source).is_file():
            parser.error(f"--project-file needs NAME=PATH with a relative name and a file: {item}")
        project_files.append((name, Path(source)))
    args.binary = args.binary or args.agent
    cases, evals = [], []
    for path in args.eval:
        data = path.read_bytes()
        loaded = json.loads(data)
        evals.append({"file": path.name, "sha256": hashlib.sha256(data).hexdigest(), "cases": len(loaded)})
        for index, case in enumerate(loaded, 1):
            cases.append({"set": path.stem.removeprefix("trigger-eval-"), **case, "index": index})
    server = describe_server(args.url, os.environ.get("CONTEXT7_API_KEY"))
    started = datetime.now(timezone.utc)
    results = []
    os.umask(0o077)
    # The fixture has its own directory, so agents cannot find the MCP configuration next to it.
    with tempfile.TemporaryDirectory(prefix="trigger-eval-") as directory, \
            tempfile.TemporaryDirectory(prefix="trigger-eval-fixture-") as fixture_directory:
        if args.project:
            args.project = args.project.resolve(strict=True)
            source = f"path:{args.project}"
        else:
            args.project = build_fixture(args.fixture_rev, Path(fixture_directory).resolve(), project_files)
            source = f"git:{args.fixture_rev}"
        problem = check_fixture(args.project)
        if problem:
            parser.error(f"Cannot use the fixture {args.project}: {problem}.")
        files, digest = fixture_digest(args.project)
        env, config = configure(args, Path(directory))
        version = subprocess.check_output([args.binary, "--version"], env=env, text=True).strip()
        with ThreadPoolExecutor(max_workers=args.workers) as pool:
            # Each repeat covers all cases before the next one starts, so drift spreads evenly.
            pending = {
                pool.submit(run_case, args, env, config, case): (case, repeat)
                for repeat in range(1, args.repeats + 1) for case in cases
            }
            for job in as_completed(pending):
                case, repeat = pending[job]
                result = {**job.result(), "index": case["index"], "repeat": repeat}
                results.append(result)
                print(result["set"], result["index"], repeat, result["error"] or result["calls"], flush=True)
        fixture = {
            "source": source, "files": files, "sha256": digest,
            "project_files": {name: hashlib.sha256(source.read_bytes()).hexdigest()
                              for name, source in project_files},
            "changed_during_run": fixture_digest(args.project) != (files, digest),
        }
    sets = list(dict.fromkeys(case["set"] for case in cases))
    results.sort(key=lambda row: (sets.index(row["set"]), row["index"], row["repeat"]))
    summary = {
        name: summarize([row for row in results if row["set"] == name], args.agent, args.repeats)
        for name in sets
    }
    commit = git("rev-parse", "HEAD")
    args.output.write_text(json.dumps({
        "agent": args.agent, "version": version, "model": args.model,
        "reasoning_effort": args.reasoning_effort if args.agent == "codex" else None,
        "codex_web_search": (args.codex_web_search or "default") if args.agent == "codex" else None,
        "codex_mcp_direct": args.codex_mcp_direct if args.agent == "codex" else None,
        "run": {
            "label": args.label, "url": args.url, "repeats": args.repeats,
            "workers": args.workers, "timeout": args.timeout,
            "started_at": started.isoformat(timespec="seconds"),
            "finished_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "runner_commit": commit.decode().strip() if commit else None,
            "runner_changed": bool(git("status", "--porcelain", "--", ".")),
        },
        "server": server, "fixture": fixture, "evals": evals,
        "summary": summary, "results": results,
    }, indent=2) + "\n")
    print(json.dumps(summary, indent=2))
    return int(any(row["error"] for row in results))


if __name__ == "__main__":
    raise SystemExit(main())
