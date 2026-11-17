# MCP instruction benchmark results

These runs cover server instructions, tool exposure, and project guidance.
Some arms enabled Claude Code's up-front tool loading metadata as an
experimental setting. The server change in [#3665](https://github.com/upstash/context7/pull/3665)
ships the instruction text. The Claude Code tool-loading control below includes
the comparison with that metadata absent in both arms.

For the normal-install answer quality comparison, see [INSTALLED.md](INSTALLED.md).
For runner instructions, see [README.md](README.md).

## Benchmark

Both clients ran the same 324 cases from neutral copies of the same project. Each
case started a fresh session, and all six follow-up cases resumed that session and
scored the second turn. The candidate uses this PR's instruction text and
`anthropic/alwaysLoad` metadata. The Codex rule arm adds the exact MCP rule from
#3669. Both server variants used the same patched Context7 MCP v4.5.0 build.

The first number is required lookups attempted. The second is extra lookups on
cases labeled against lookup.

| Client      | Configuration                | Tuning        | Held-out    | Behavior    | Many libraries |
| ----------- | ---------------------------- | ------------- | ----------- | ----------- | -------------- |
| Claude Code | Baseline server              | 27/111, 0/50  | 7/60, 0/30  | 6/24, 0/25  | 3/24           |
| Claude Code | Candidate server             | 104/111, 0/50 | 59/60, 0/30 | 23/24, 1/25 | 23/24          |
| Codex       | Baseline server              | 0/111, 0/50   | 0/60, 0/30  | 0/24, 0/25  | 0/24           |
| Codex       | Candidate server             | 0/111, 0/50   | 0/60, 0/30  | 0/24, 0/25  | 0/24           |
| Codex       | Candidate server + AGENTS.md | 111/111, 6/50 | 60/60, 0/30 | 24/24, 4/25 | 24/24          |

| Client      | Configuration                | Client errors | Tool errors | Behavior check failures | Many-library budget failures | Secret checks failed | Follow-ups without a prior query |
| ----------- | ---------------------------- | ------------: | ----------: | ----------------------: | ---------------------------: | -------------------: | -------------------------------: |
| Claude Code | Baseline server              |             0 |           1 |                       0 |                            0 |                    0 |                                5 |
| Claude Code | Candidate server             |             0 |           9 |                       0 |                            3 |                    0 |                                0 |
| Codex       | Baseline server              |             0 |           0 |                       0 |                            0 |                    0 |                                6 |
| Codex       | Candidate server             |             0 |           0 |                       0 |                            0 |                    0 |                                6 |
| Codex       | Candidate server + AGENTS.md |             0 |           0 |                       0 |                            9 |                    0 |                                0 |

Clients used Claude Code 2.1.318 with `claude-opus-5-5` and codex-cli 0.166.0-alpha.6 with `gpt-6.1-sol` at low reasoning effort.
One Claude Code held-out turn exited early. The table includes its completed retry.
A failed tool call still counts as an attempt.
A separate prompt explicitly requesting Context7 successfully resolved a library and fetched docs in both Codex server-only configurations.

## Codex configuration verification

Replayed 12 held-out prompts that had previously called Context7 in at least one arm.
Five Codex configurations, including the earlier settings and the standalone CLI,
produced zero calls on those prompts. Each configuration resolved a library and
fetched docs in an explicit control. The MCP server logged exactly the ten control
requests, and the current parser also recognized Context7 calls in six archived traces.

Then reran all 90 held-out prompts against both server variants. The same isolated
Codex configuration was used in each rerun, with web search disabled for the separate
diagnostic. These results use no project rule.

| Codex web search | Server    | Required lookups | Unneeded lookup cases | Positive cases using web search |
| ---------------- | --------- | ---------------: | --------------------: | ------------------------------: |
| Default          | Baseline  |             1/60 |                  0/30 |                           56/60 |
| Default          | Candidate |             0/60 |                  0/30 |                           55/60 |
| Disabled         | Baseline  |             8/60 |                  0/30 |                            0/60 |
| Disabled         | Candidate |             9/60 |                  0/30 |                            0/60 |

For each arm, the runner's Context7 call counts matched the independent MCP server log.
The web-search override is available as `--codex-web-search disabled`.

## Codex with Context7 exposed up front

The [Codex configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference)
documents the per-server `omit_tools_from` setting. The runner's
`--codex-mcp-direct` sets the documented direct-exposure configuration for
Context7. A paired request trace on Codex 0.166.0-alpha.6 confirmed that the
initial request contains both tools and the exact candidate server text as
the Context7 namespace description with this setting.

The rerun used all 90 held-out cases, default web search, and no `AGENTS.md` rule.
Both server variants used the same direct-exposure setting so the comparison isolates the server changes.

| Server    | Positive cases with any Context7 call | Positive cases with a query-docs call | Negative cases with a Context7 call | Positive cases using web search | Client errors |
| --------- | ------------------------------------: | ------------------------------------: | ----------------------------------: | ------------------------------: | ------------: |
| Baseline  |                                 60/60 |                                 58/60 |                                0/30 |                            6/60 |             0 |
| Candidate |                                 60/60 |                                 59/60 |                                0/30 |                           12/60 |             0 |

The baseline first-request trace also contains both tools and the exact server
instructions from the base commit. In the baseline, two positive cases called
only the library resolver. In the candidate, one did.

The Codex event counts matched the independent MCP server logs in both runs.

## Full Codex suite with Context7 exposed up front

The direct exposure results cover the full 324-case suite for each server,
with default web search and no `AGENTS.md` rule. The behavior set includes
six resumed sessions. The table scores the second turn for those cases.

| Set            | Old with any Context7 call | New with any Context7 call | Old with a query-docs call | New with a query-docs call | Old unneeded lookup cases | New unneeded lookup cases |
| -------------- | -------------------------: | -------------------------: | -------------------------: | -------------------------: | ------------------------: | ------------------------: |
| Tuning         |                    108/111 |                    109/111 |                    107/111 |                    108/111 |                      5/50 |                      5/50 |
| Held-out       |                      60/60 |                      60/60 |                      58/60 |                      59/60 |                      0/30 |                      0/30 |
| Behavior       |                      19/24 |                      24/24 |                      17/24 |                      21/24 |                      2/25 |                      2/25 |
| Many libraries |                      24/24 |                      24/24 |                      21/24 |                      21/24 |                       N/A |                       N/A |
| All cases      |                    211/219 |                    217/219 |                    203/219 |                    209/219 |                     7/105 |                     7/105 |

| Server    | Client errors | MCP tool errors | Behavior check failures | Many-library budget failures | Synthetic secret checks failed |
| --------- | ------------: | --------------: | ----------------------: | ---------------------------: | -----------------------------: |
| Baseline  |             0 |               0 |                       1 |                            0 |                              0 |
| Candidate |             0 |               0 |                       0 |                            0 |                              0 |

The independent MCP server logs matched the recorded tool events in both runs.

## Claude Code tool-loading control

The original Claude Code comparison changed the server prompt and the up-front tool hint together.
The Codex direct-exposure comparison kept exposure fixed for both prompts.
To separate those effects, the Claude Code control ran the missing combinations on
all 324 cases with Opus 5.5, the same fixture and no project rule.

| Claude Code tool loading                 | Server prompt | Required cases with any Context7 call | Required cases with a query-docs call | Unneeded lookup cases | Client errors |
| ---------------------------------------- | ------------- | ------------------------------------: | ------------------------------------: | --------------------: | ------------: |
| No server hint                           | Old           |                                43/219 |                                42/219 |                 0/105 |             0 |
| No server hint                           | New           |                               203/219 |                               202/219 |                 0/105 |             0 |
| Server hints both tools to load up front | Old           |                                65/219 |                                64/219 |                 0/105 |             0 |
| Server hints both tools to load up front | New           |                               209/219 |                               206/219 |                 1/105 |             0 |

A separate 90-case control used `ENABLE_TOOL_SEARCH=false` and
`MCP_CONNECTION_NONBLOCKING=0` to load the tools up front and wait for
the server before sending the prompt.

| Claude Code prompt with client-side up-front loading | Required cases with any Context7 call | Required cases with a query-docs call | Unneeded lookup cases | Client errors |
| ---------------------------------------------------- | ------------------------------------: | ------------------------------------: | --------------------: | ------------: |
| Old                                                  |                                 11/60 |                                 11/60 |                  0/30 |             0 |
| New                                                  |                                 60/60 |                                 60/60 |                  0/30 |             0 |

A local first-request probe confirmed that Claude Code includes the exact server
instructions in a message and both tool definitions without deferral. The
Codex direct-exposure trace carries the instructions in the tool namespace
description. This control measures each client and model together.

Two incomplete old-prompt turns in the server-hint run completed on retry.
The original new-prompt run also includes its one completed retry.
[Claude Code MCP loading settings](https://code.claude.com/docs/en/mcp).

## Pi on OpenRouter

Pi 1.5.0 ran both 324-case configurations with `anthropic/claude-opus-5.5` on
OpenRouter and native MCP tools exposed directly. A local request trace showed
that native direct exposure supplies both tool definitions while omitting the
server instructions. This comparison passes the exact server text via
`--append-system-prompt` in both configurations, with project context files and
skills disabled. A second local trace verified both tools and the exact text.

| Set            | Old any Context7 call | New any Context7 call | Old query-docs call | New query-docs call | Old unneeded lookup cases | New unneeded lookup cases |
| -------------- | --------------------: | --------------------: | ------------------: | ------------------: | ------------------------: | ------------------------: |
| Tuning         |               110/111 |               111/111 |             110/111 |             111/111 |                      0/50 |                      3/50 |
| Held-out       |                 60/60 |                 60/60 |               60/60 |               60/60 |                      0/30 |                      0/30 |
| Behavior       |                 23/24 |                 24/24 |               21/24 |               23/24 |                      2/25 |                      1/25 |
| Many libraries |                 21/24 |                 24/24 |               20/24 |               24/24 |                       N/A |                       N/A |
| All cases      |               214/219 |               219/219 |             211/219 |             218/219 |                     2/105 |                     4/105 |

| Prompt | Client errors | MCP tool errors | Behavior check failures | Many-library budget failures | Synthetic secret checks failed | Completed follow-ups |
| ------ | ------------: | --------------: | ----------------------: | ---------------------------: | -----------------------------: | -------------------: |
| Old    |             0 |               4 |                       0 |                            2 |                              0 |                  6/6 |
| New    |             0 |               2 |                       0 |                            2 |                              0 |                  6/6 |

The initial runs' tool events matched the independent MCP server logs.

OpenCode 1.18.15 completed the explicit Context7 lookup control against both
servers through OpenRouter. Three of ten pilot cases hit client errors.
The captured candidate request contained both Context7 tool definitions
and omitted the candidate server instructions.
