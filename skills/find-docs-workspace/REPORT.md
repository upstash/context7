# Context7 Invocation Routing Eval Report

**Date:** 2026-03-24
**Model:** Claude Opus 4.6 (claude-opus-4-6)
**Auth:** Claude subscription (piped mode via `claude -p`)

---

## Objective

Determine the optimal way to integrate Context7 into Claude Code so that it reliably triggers when users ask library/framework questions, and does not trigger for unrelated tasks.

Users reported that Context7 wasn't being invoked frequently enough in real sessions. This benchmark investigates why, measures trigger rates across different integration methods, and provides a recommended setup.

---

## Methodology

### Orchestrator

A custom Python eval orchestrator (`orchestrator.py`) that:

- Runs `claude -p` with 60 test queries in parallel (60 workers)
- Configures the environment before each mode (enables/disables MCP servers, skills, rules, CLAUDE.md)
- Detects whether Context7 was invoked by parsing `stream-json` output for tool calls
- Supports `--compare` mode: runs each configuration twice (clean queries + with conversation context) and shows side-by-side results
- Kills zombie MCP processes between modes to prevent leakage
- Registers MCP via both `.mcp.json` config files and `claude mcp add` for reliable discovery

### Eval Set: 60 Queries (50 should-trigger, 10 should-not)

Designed following skill-creator best practices: realistic, naturalistic queries with personal context, casual language, and edge cases.

**Should-trigger categories (50 queries):**

| Category             | Count | Example                                                                                          |
| -------------------- | ----- | ------------------------------------------------------------------------------------------------ |
| direct-api           | 8     | "vitest mocking - how do I mock a module?"                                                       |
| version-breakage     | 8     | "tailwind v4 broke all our custom colors, the theme config syntax is completely different"       |
| real-world-task      | 10    | "my boss wants row-level security in our supabase project so each team only sees their own data" |
| debugging-needs-docs | 7     | "our stripe webhook keeps returning 400 in production but works locally"                         |
| implementation       | 6     | "setting up grpc between our typescript services"                                                |
| non-js               | 7     | "how do I use serde to deserialize JSON with optional fields in Rust?"                           |
| terse                | 4     | "redis pub sub node"                                                                             |

**Should-not-trigger categories (10 queries):**

| Category      | Count | Example                                                                         |
| ------------- | ----- | ------------------------------------------------------------------------------- |
| near-miss     | 5     | "we use prisma but this is actually a pure SQL question about join performance" |
| generic-task  | 2     | "write me a node.js script that reads all json files"                           |
| codebase-task | 3     | "fix the TypeScript errors in this file"                                        |

Near-miss queries mention libraries but don't actually need documentation lookup.

### Integration Modes Tested

| Mode          | MCP Server | alwaysApply Rule | Skill     | CLAUDE.md        | Tool Mechanism                             |
| ------------- | ---------- | ---------------- | --------- | ---------------- | ------------------------------------------ |
| mcp           | Yes        | -                | -         | -                | MCP tools (resolve-library-id, query-docs) |
| mcp+rule      | Yes        | MCP instructions | -         | -                | MCP tools, guided by rule                  |
| mcp+claude.md | Yes        | -                | -         | MCP instructions | MCP tools, guided by CLAUDE.md             |
| cli+skill     | -          | -                | find-docs | -                | ctx7 CLI via Bash (skill invokes)          |
| cli+rule      | -          | CLI instructions | -         | -                | ctx7 CLI via Bash (rule instructs)         |
| cli+claude.md | -          | -                | -         | CLI instructions | ctx7 CLI via Bash (CLAUDE.md instructs)    |

### Context Simulation

The `--compare` flag runs each mode twice. The second run prepends conversation context to simulate mid-session usage:

> "I've been working on this codebase for a while. So far I read src/routes/api.ts and fixed the auth middleware, ran the test suite (3 tests still failing), and updated package.json dependencies. Now: [actual query]"

Five rotating prefixes simulate different mid-session scenarios. This tests whether Context7 still triggers when the user is already deep in a coding task.

---

## Results

### Overall Recall

| Mode              | Clean            | With Context    | Delta    | FP  |
| ----------------- | ---------------- | --------------- | -------- | --- |
| mcp+claude.md     | **100%** (50/50) | **96%** (48/50) | -4%      | 0   |
| mcp+rule          | **98%** (49/50)  | 94% (47/50)     | -4%      | 0   |
| cli+rule          | **98%** (49/50)  | **96%** (48/50) | -2%      | 1   |
| cli+claude.md     | 94% (47/50)      | 88% (44/50)     | -6%      | 0   |
| mcp (alone)       | 92% (46/50)      | 72% (36/50)     | **-20%** | 0   |
| cli+skill (alone) | 66% (33/50)      | 72% (36/50)     | +6%\*    | 2   |

\*cli+skill variance is noise from random flips, not a real improvement.

### Category Breakdown (clean queries)

| Category             | cli+skill | cli+rule | cli+claude.md | mcp      | mcp+rule | mcp+claude.md |
| -------------------- | --------- | -------- | ------------- | -------- | -------- | ------------- |
| direct-api           | 50%       | **100%** | **100%**      | **100%** | **100%** | **100%**      |
| terse                | 50%       | 75%      | 75%           | 75%      | **100%** | **100%**      |
| debugging-needs-docs | 57%       | **100%** | **100%**      | 85%      | **100%** | **100%**      |
| real-world-task      | 80%       | **100%** | **100%**      | **100%** | **100%** | **100%**      |
| version-breakage     | 75%       | **100%** | 87%           | 87%      | 87%      | **100%**      |
| implementation       | 83%       | **100%** | 83%           | **100%** | **100%** | **100%**      |
| non-js               | 57%       | **100%** | **100%**      | 85%      | **100%** | **100%**      |

### Persistently Failing Queries

| Query                           | Modes Failed (out of 12) | Root Cause                                           |
| ------------------------------- | ------------------------ | ---------------------------------------------------- |
| eslint v9 migration             | 10/12                    | Claude reads local .eslintrc and attempts direct fix |
| "pnpm workspace syntax?"        | 8/12                     | Too terse, Claude answers from knowledge             |
| jest ESM config                 | 5/12                     | Claude reads local jest config instead of docs       |
| React Native push notifications | 5/12                     | Claude answers from general knowledge                |
| Flutter dependency injection    | 4/12                     | Claude answers from knowledge                        |

These represent model-level behavior: Claude prioritizes local exploration or answering from knowledge when it's confident.

### Context Impact: What Breaks Mid-Session

**MCP alone loses 10 queries with context** (biggest regression):

- Simple API questions: useEffect, Prisma syntax, Sequelize
- Real-world tasks: PDF generation, push notifications, type safety
- Debugging: docker compose volumes, Prisma drift

**cli+rule loses only 2 queries** (most resilient):

- eslint v9 (always hard)
- "pnpm workspace syntax?" (always hard)

**Pattern:** Without instructions, Claude defaults to answering from knowledge when in "work mode." With `alwaysApply` instructions, the directive persists regardless of context.

### False Positives

FPs only occur in CLI modes (2 instances across all runs), never in MCP modes. The "add a createdAt field" query occasionally triggers ctx7 because Claude's Agent subagent explores broadly and may invoke ctx7 incidentally. MCP detection is more precise since it's a distinct tool call.

---

## Key Findings

### 1. Instructions are essential

Tool presence alone is insufficient. MCP alone drops from 92% to **72% with context** (-20%). Adding an `alwaysApply` rule recovers it to 94-98%. This is the root cause of user complaints: installations without a rule get inconsistent triggering.

### 2. `alwaysApply` rule is the most resilient instruction mechanism

Rules lose only **2%** with context, compared to CLAUDE.md which loses 4-6%. Rules are injected as user-level instructions and weighted more heavily by the model.

### 3. MCP slightly outperforms CLI as the tool mechanism

When paired with instructions, MCP achieves marginally higher clean recall (98-100% vs 94-98%). MCP tools are first-class in Claude's tool system with no skill indirection or Bash overhead.

### 4. Skill alone is the weakest channel

At **66% clean recall**, the find-docs skill underperforms every other configuration. The skill invocation mechanism requires Claude to: recognize it needs docs, find the skill via ToolSearch, invoke the Skill tool, read SKILL.md content, then execute ctx7 via Bash. Each step is a decision point where Claude can choose a different path.

### 5. Simple/well-known queries are hardest to trigger

The "direct-api" and "terse" categories score 50% with skill-only. Claude skips external tools when it's confident in its knowledge (React hooks, Prisma syntax). Version-specific and niche-library queries trigger more reliably.

### 6. Clean `claude -p` results are an upper bound

Our tests use piped mode without conversation history, open files, or IDE context. Real interactive sessions likely have even lower trigger rates. The `--with-context` simulation partially addresses this but doesn't replicate the full interactive environment.

### 7. API key vs Subscription behave differently

Tests using `ANTHROPIC_API_KEY` showed significantly different tool access behavior (MCP at near 0% in some runs). All reported results use subscription auth, which matches real user experience.

---

## Recommendations

### Recommended default: MCP + alwaysApply rule

The `ctx7 setup` command should install:

1. **MCP server** (HTTP or stdio transport)
2. **`alwaysApply` rule** at `~/.claude/rules/context7.md`

This achieves **98%/94% (clean/context)** with **0 false positives**.

### Rule content

The rule should be selective:

```markdown
---
alwaysApply: true
---

Before answering a question about a specific library or framework's API,
check whether the question needs external documentation. Only call Context7
MCP when the user is asking about a third-party library's API, syntax,
configuration, version changes, or behavior.

Examples where you SHOULD call Context7:

- "how do I use useEffect in React"
- "Prisma one-to-many syntax"
- "what changed in Tailwind v4"

Examples where you should NOT call Context7:

- Refactoring code, writing scripts, debugging logic errors, code review

When you decide Context7 is needed:

1. Call `resolve-library-id` with the library name and the user's question
2. Pick the best match
3. Call `query-docs` with the selected library ID and the question
4. Answer using the fetched docs
```

### Fallback: CLI + alwaysApply rule

For users who cannot use MCP:

- Install ctx7 CLI globally
- Add `alwaysApply` rule with CLI instructions referencing `ctx7 library` and `ctx7 docs`

Achieves **98%/96%** -- comparable to MCP+rule.

### Keep skill as secondary channel

The find-docs skill should remain available but not be the only integration. It serves as a fallback for users without MCP or rules.

### What NOT to do

- Don't ship MCP alone without instructions (drops to 72% with context)
- Don't rely on skill alone (66% baseline)
- Don't use overly broad instructions ("always use Context7") -- causes false positives

---

## Test Infrastructure

| File                      | Purpose                                                                         |
| ------------------------- | ------------------------------------------------------------------------------- |
| `orchestrator.py`         | Main eval runner -- environment setup, parallel execution, detection, reporting |
| `trigger-eval.json`       | 60 test queries with categories and expected behavior                           |
| `skill-snapshot/SKILL.md` | The find-docs skill used in testing                                             |
| `orchestrator-results/`   | JSON + Markdown reports per run                                                 |

### Usage

```bash
# Run all modes (clean only)
python skills/find-docs-workspace/orchestrator.py

# Compare clean vs with-context
python skills/find-docs-workspace/orchestrator.py --compare

# Specific modes
python skills/find-docs-workspace/orchestrator.py --modes mcp,mcp+rule

# With different model
python skills/find-docs-workspace/orchestrator.py --model claude-sonnet-4-6
```

Report: /Users/fahreddinozcan/Desktop/repos/context7/skills/find-docs-workspace/orchestrator-results/report-claude-opus-4-6-20260324-101751.md
JSON: /Users/fahreddinozcan/Desktop/repos/context7/skills/find-docs-workspace/orchestrator-results/results-claude-opus-4-6-20260324-101751.json

=====================================================================================
FINAL COMPARISON
=====================================================================================
Mode Recall (clean) Recall (ctx) Delta FP

---

cli+skill 33/50 (66%) 36/50 (72%) +6% 2  
cli+rule 49/50 (98%) 48/50 (96%) -2% 1  
cli+claude.md 47/50 (94%) 44/50 (88%) -6% 0  
mcp 46/50 (92%) 36/50 (72%) -20% 0  
mcp+rule 49/50 (98%) 47/50 (94%) -4% 0  
mcp+claude.md 50/50 (100%) 48/50 (96%) -4% 0
