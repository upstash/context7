# Claude Code after normal Context7 MCP setup

This comparison uses the 90 held-out cases, with 60 documentation cases and 30
cases that should skip Context7. The published `ctx7` 0.9.0 project installer
added the MCP entry, rule, and skill. Both arms kept the same rule and skill
and used Claude Code 2.1.318 with Opus 5.5.

The run redirected the MCP entry to two local benchmark servers. Both used the
same patched Context7 MCP v4.5.0 build. The old arm used the base revision's
server text. The new arm used the candidate text and its up-front tool loading
metadata. Each case ran once per arm. The runner preapproved Context7 calls for
headless execution and allowed edits for the one README patch case, in its own
disposable copy.

| Metric                                        | Old server | New server |
| --------------------------------------------- | ---------: | ---------: |
| Any Context7 call on lookup cases             |      60/60 |      60/60 |
| Reached `query-docs` on lookup cases          |      60/60 |      59/60 |
| Unnecessary lookup cases                      |       1/30 |       0/30 |
| Fully correct answers, GPT-5.4 mini           |      73/90 |      73/90 |
| Fully correct answers, Gemini 3.1 Pro Preview |      88/90 |      87/90 |

Both judges scored each pair in randomized order with the server labels hidden.
They used shared documentation references for all 60 library cases and fixture
evidence for repository tasks. They scored correct, partial, and incorrect as
2, 1, and 0. The README task was judged from the applied diff. Their full-credit
thresholds differed. Neither judge found a gain in fully correct answers.
[`results-installed.json`](results-installed.json) contains per-case call counts
and scores.

In the separate server-only wording control, Claude Code used Context7 on
43/219 required cases with the old wording and 203/219 with the new wording,
with the up-front loading hint absent in both arms. Both had 0/105 unnecessary
lookups. That control measures lookup coverage. The normal-install run above
measures the incremental effect of changing the server for users with the
installed rule and skill. [Server change and benchmark results](https://github.com/upstash/context7/pull/3665)

## Reproduce

Use one disposable, neutral repository snapshot with the files used by the
held-out repository tasks. The recorded run used the original benchmark
snapshot. Use the same snapshot in both arms. Repository-specific answers and
patches depend on the snapshot.

Run the standard project installer in that directory once. Confirm it creates
the MCP entry, Context7 rule, and skill. The runner copies the installed
directory and overrides the Context7 URL and API key in its temporary copy.
Supply `CONTEXT7_API_KEY` for the MCP server and references. Supply
`OPENROUTER_API_KEY` for judging. Keep the raw answers private.

```sh
# Run in the neutral fixture.
npx ctx7@0.9.0 setup --claude --mcp --project --yes

# Run from this benchmark directory.
python3 run-installed.py --project "$BENCH_PROJECT" --url http://127.0.0.1:7311/mcp \
  --output /tmp/ctx7-old.jsonl
python3 run-installed.py --project "$BENCH_PROJECT" --url http://127.0.0.1:7312/mcp \
  --output /tmp/ctx7-new.jsonl

python3 fetch-installed-references.py --output /tmp/ctx7-references.json
python3 grade-installed.py --fixture "$BENCH_PROJECT" --old /tmp/ctx7-old.jsonl \
  --new /tmp/ctx7-new.jsonl --references /tmp/ctx7-references.json \
  --judge primary --output /tmp/ctx7-gpt-grades.jsonl
python3 grade-installed.py --fixture "$BENCH_PROJECT" --old /tmp/ctx7-old.jsonl \
  --new /tmp/ctx7-new.jsonl --references /tmp/ctx7-references.json \
  --judge second --output /tmp/ctx7-gemini-grades.jsonl
```

Run `run-installed.py --case NUMBER` with a fresh output file to retry a
failed case, then replace that case's row before grading. References come from
the live Context7 index and can change between runs.
