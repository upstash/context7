# MCP instruction benchmark

The runner uses the same labeled prompts and checks for Claude Code and Codex. Each
case starts a new session. The six cases with a follow-up resume that session and
score only the second turn. The report also counts follow-ups where the first turn
never called `query-docs`.

| File                        | Cases | Coverage                                                                                          |
| --------------------------- | ----: | ------------------------------------------------------------------------------------------------- |
| `trigger-eval-all.json`     |   251 | 161 tuning and 90 held-out prompts                                                                |
| `trigger-eval-aspects.json` |    49 | Routine work, repository edits, follow-ups, supplied IDs, synthetic secrets, and failure handling |
| `trigger-eval-many.json`    |    24 | Prompts that can exceed the intended call budget                                                  |

## Run

Use Python 3.9 or later and signed-in client binaries that support the model you
select. Start a local HTTP MCP server for each variant you want to compare. For
example, build the MCP package in the base and candidate checkouts, then run
`node packages/mcp/dist/index.js --transport http --port 7311` from the base
checkout and the same command on port 7312 from the candidate checkout.
Supply `CONTEXT7_API_KEY` in the runner's environment if your endpoint needs it.
Use a test key. Temporary MCP configuration stays outside the fixture directory
and is removed when the run exits.

Use the same source snapshot in two disposable, neutrally named fixture directories
outside the repo. The behavior cases refer to files in this monorepo, so include
those files. For example, archive the base revision into a temporary directory
named `project`. Leave it free of agent rules, skills, and plugins. Copy that
fixture and install the rule under test as `AGENTS.md` in the copy. Avoid using
`context7` in the fixture path because it can bias tool selection.

From this directory, run the same three files for each configuration:

```sh
python3 run.py --agent claude --model claude-opus-5-5 \
  --project "$BENCH_PROJECT" --url http://127.0.0.1:7312/mcp \
  --eval trigger-eval-all.json --eval trigger-eval-aspects.json \
  --eval trigger-eval-many.json --output /tmp/claude-candidate.json

python3 run.py --agent codex --model gpt-6.1-sol \
  --project "$BENCH_PROJECT" --url http://127.0.0.1:7312/mcp \
  --eval trigger-eval-all.json --eval trigger-eval-aspects.json \
  --eval trigger-eval-many.json --output /tmp/codex-candidate.json
```

Repeat both commands against the baseline endpoint. For the Codex rule arm, keep
the candidate endpoint and change only the fixture to the copy with `AGENTS.md`.
Set `--binary` if the executable on your path lacks access to the chosen model.
Codex uses a temporary home with a copy of its auth and model cache, low reasoning
effort by default, and a read-only sandbox. Claude Code uses its existing sign-in,
loads project settings only, and allows the two Context7 tools. Claude Code writes
local session records for the cases that need to resume.

## Scoring

Recall counts cases labeled for lookup that attempt at least one Context7 tool
call. False positives count cases labeled against lookup that attempt a call.
Both use completed client turns as their denominators. A run exits nonzero if any
turn fails or times out. The report tracks tool errors separately because an
attempt can count toward recall even when the tool fails. The benchmark measures
tool choice and the listed behavioral checks. It does not grade answer accuracy
or the application of repository edits.

Behavioral checks cover the per-tool and case-specific call budgets, supplied
library IDs, whether the model sends a synthetic secret to Context7, and whether
selected cases produce an answer. The JSON report includes the client version,
model, summary, and per-case call sequence. It omits raw prompts, answers, tool
arguments, and credentials.
