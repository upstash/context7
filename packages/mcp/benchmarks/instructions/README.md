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

See [the normal-install benchmark](INSTALLED.md) for answer correctness and lookup results after setup.

See [the recorded results](RESULTS.md) for the other benchmark configurations.

## Run

Use Python 3.9 or later and signed-in client binaries that support the model you
select. Start a local HTTP MCP server for each variant you want to compare. For
example, build the MCP package in the base and candidate checkouts, then run
`node packages/mcp/dist/index.js --transport http --port 7311` from the base
checkout and the same command on port 7312 from the candidate checkout.
Supply `CONTEXT7_API_KEY` in the runner's environment if your endpoint needs it.
Use a test key. Temporary MCP configuration stays outside the fixture directory
and is removed when the run exits.

The runner makes the fixture for each run. It archives the pinned commit
`FIXTURE_REV` into a new temporary directory named `project` and removes the
paths that agents load on their own, such as `.agents`, `.claude`, `rules`, and
`AGENTS.md`. The fixture is removed when the run exits, so no run can use a stale
or partly deleted copy. `--fixture-rev` selects a different commit. `--project`
uses a directory that you made yourself, as it is. The runner stops if the fixture
lacks a file that the repository cases name, or if its path contains `context7`,
which can bias tool selection. One held-out case asks about `packages/evals`. No
commit contains that folder, so the correct answer for that case is that the folder
does not exist.

From this directory, run the same three files for each configuration:

```sh
python3 run.py --agent claude --model claude-opus-5-5 \
  --url http://127.0.0.1:7312/mcp --label candidate \
  --eval trigger-eval-all.json --eval trigger-eval-aspects.json \
  --eval trigger-eval-many.json --output /tmp/claude-candidate.json

python3 run.py --agent codex --model gpt-6.1-sol \
  --url http://127.0.0.1:7312/mcp --label candidate \
  --eval trigger-eval-all.json --eval trigger-eval-aspects.json \
  --eval trigger-eval-many.json --output /tmp/codex-candidate.json
```

Each case runs three times by default. `--repeats 1` gives a quick pass, but do
not compare variants on one run per case. Earlier single runs of one configuration
differed by about three points on the 171 lookup cases.

Repeat both commands against the baseline endpoint. For the Codex rule arm, keep
the candidate endpoint and add `--project-file AGENTS.md=path/to/rule.md`, which
copies the rule under test into the fixture.
Set `--binary` if the executable on your path lacks access to the chosen model.
Codex uses a temporary home with a copy of its auth and model cache, low reasoning
effort by default, and a read-only sandbox. Claude Code uses its existing sign-in,
loads project settings only, and allows the two Context7 tools. Claude Code writes
local session records for the cases that need to resume.

Leave Codex web search at its default for the main comparison. Run the same
commands with `--codex-web-search disabled` to measure tool selection when web
search is unavailable. Keep those results separate from the main comparison.
The Codex report counts cases that used web search.

To compare server instructions with Context7 in Codex's initial tool list, run
both server variants with `--codex-mcp-direct`, default web search, and no
project rule. The flag sets `omit_tools_from = ["deferred", "code_mode"]` for
Context7. Keep this comparison separate from default discovery. Confirm the
initial tool list when changing Codex versions or model settings, since runtime
policies can override the server's exposure setting.
[Codex configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference).

## Scoring

Recall counts cases labeled for lookup that attempt at least one Context7 tool
call. False positives count cases labeled against lookup that attempt a call.
Both use completed client turns as their denominators and pool all repeats. The
summary also gives each rate per repeat, and `unstable_cases` counts the cases
whose repeats disagree on whether to call Context7. Treat a difference between two
variants as real only if it is larger than the spread between repeats. A run exits
nonzero if any turn fails or times out. The report tracks tool errors separately because an
attempt can count toward recall even when the tool fails. The benchmark measures
tool choice and the listed behavioral checks. It does not grade answer accuracy
or the application of repository edits.

Behavioral checks cover the per-tool and case-specific call budgets, supplied
library IDs, whether the model sends a synthetic secret to Context7, and whether
selected cases produce an answer. The JSON report includes the client version,
model, summary, and the call sequence of each run of each case. It omits raw
prompts, answers, tool arguments, and credentials.

The report also records what the run measured:

- `run`: the label, endpoint URL, repeats, start and end time, and the runner commit.
- `server`: the server version, the length and SHA-256 of the instructions that the
  endpoint served, and for each tool its description length and whether it asks
  Claude Code to load it up front. Compare the hash with the text you meant to test.
- `fixture`: the commit or path, the file count, a content hash, the hash of each
  `--project-file`, and whether a file changed during the run.
- `evals`: the name, SHA-256, and case count of each eval file.

The runner asks the endpoint for this data before the first case and stops if the
endpoint does not answer.
