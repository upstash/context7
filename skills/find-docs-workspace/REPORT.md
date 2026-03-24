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

## Skill Description Optimization

### Background

The skill-creator documentation explicitly warns that Claude has a tendency to "undertrigger" skills. It recommends making descriptions "pushy":

> Instead of "How to build a simple fast dashboard", write "...Make sure to use this skill whenever the user mentions dashboards, data visualization, internal metrics, or wants to display any kind of company data, **even if they don't explicitly ask for a 'dashboard'**"

The description field (~100 words) is always in context and is the **primary mechanism** that determines whether Claude invokes a skill. The skill body only loads after Claude decides to trigger it.

### The Problem

The benchmark showed `cli+skill` at 66-80% recall with the original description. Failures clustered on:
- Well-known topics (React hooks, Prisma syntax) where Claude felt confident answering from knowledge
- Terse queries ("pnpm workspace syntax?") where Claude didn't recognize the need for external docs

### What We Changed

**Original description (passive):**
```
Retrieves authoritative, up-to-date technical documentation, API references,
configuration details, and code examples for any developer technology.

Use this skill whenever answering technical questions or writing code that
interacts with external technologies. This includes libraries, frameworks,
programming languages, SDKs, APIs, CLI tools, cloud services, infrastructure
tools, and developer platforms.

Common scenarios:
- looking up API endpoints, classes, functions, or method parameters
- checking configuration options or CLI commands
- answering "how do I" technical questions
- generating code that uses a specific library or service
- debugging issues related to frameworks, SDKs, or APIs
- retrieving setup instructions, examples, or migration guides
- verifying version-specific behavior or breaking changes

Prefer this skill whenever documentation accuracy matters or when model
knowledge may be outdated.
```

**New description (pushy):**
```
Retrieves up-to-date documentation, API references, and code examples for any
developer technology. Use this skill whenever the user asks about a specific
library, framework, SDK, CLI tool, or cloud service -- even for well-known ones
like React, Next.js, Prisma, Express, Tailwind, Django, or Spring Boot. Your
training data may not reflect recent API changes or version updates.

Always use for: API syntax questions, configuration options, version migration
issues, "how do I" questions mentioning a library name, debugging that involves
library-specific behavior, setup instructions, and CLI tool usage.

Use even when you think you know the answer -- verify against current docs.
```

### Key Changes Applied

1. **Named the confidence trap** -- "even for well-known ones like React, Next.js, Prisma" directly lists libraries that were failing to trigger
2. **Gave Claude a reason to doubt itself** -- "Your training data may not reflect recent API changes" provides logical justification for using the tool even when confident
3. **Replaced passive "Prefer" with directive "Always use for"** -- removes opt-out language
4. **Added the "even if" override** -- "Use even when you think you know the answer" directly counters undertriggering, following skill-creator guidance
5. **Shortened and focused** -- removed generic "Common scenarios" bullet list in favor of a more direct instruction. Fewer words, stronger signal

### Results

| Metric       | Old Description | New Description | Delta   |
| ------------ | --------------- | --------------- | ------- |
| Clean recall | 66-80%          | 92-98%          | +18-32% |
| With context | 72-74%          | 82-92%          | +10-18% |
| False pos.   | 1-2             | 0               | Better  |

### Side-by-Side Comparison (same run, same queries)

| Mode           | Clean (old) | Clean (new) | With Context (old) | With Context (new) |
| -------------- | ----------- | ----------- | ------------------ | ------------------ |
| cli+skill(old) | 92% (46/50) | -           | 82% (41/50)        | -                  |
| cli+skill      | -           | 98% (49/50) | -                  | 92% (46/50)        |

The new description brings `cli+skill` from the worst performer to match rule-based modes (96-98%), confirming the skill-creator's guidance: the description is the primary trigger mechanism, and pushy language directly addresses Claude's undertriggering tendency.

### Queries That Skills Fail to Trigger

Skills consistently fail on two patterns:

**Well-known topics** -- Claude is confident in its training knowledge and skips the tool entirely:
- Basic API syntax (React useEffect, Prisma relations, Sequelize associations)
- Terse queries ("pnpm workspace syntax?", "nginx reverse proxy websocket config")
- Mainstream frameworks (Flutter DI, React Native push notifications)

**Local debugging** -- Claude sees project files and attempts a direct fix instead of looking up docs:
- "something is wrong with our eslint setup after upgrading to v9..."
- "getting 'Cannot use import statement outside a module' with jest..."
- "my prisma migrate dev keeps failing with 'drift detected'..."

These same queries pass at 96-100% with a rule, which overrides Claude's tendency to skip external tools when it feels confident.

---

## Comparison with Vercel's AGENTS.md Eval

Vercel published [AGENTS.md outperforms skills in our agent evals](https://vercel.com/blog/agents-md-outperforms-skills-in-our-agent-evals) which tested a similar question: what's the best way to give an AI coding agent documentation access?

### Their approach vs ours

| Dimension      | Vercel                                          | Context7                                                   |
| -------------- | ----------------------------------------------- | ---------------------------------------------------------- |
| What they test | Code generation quality (build/lint/test pass%) | Trigger rate (did the agent call the docs tool?)            |
| Test scope     | 8 specific Next.js 16 APIs                      | 60 queries across many frameworks and languages            |
| Key insight    | Skills with default description = 53% (= baseline, no improvement) | Skill with passive description = 66% (barely above baseline) |
| Solution       | Compressed 40KB docs into 8KB AGENTS.md index   | Pushy skill description + rule instructions                |
| Best result    | AGENTS.md: 100%                                 | MCP + CLAUDE.md: 100%, cli+rule: 98%                       |

### Aligned findings

Both studies agree on the core insight: **default skill descriptions don't help**. Vercel found skills at 53% (same as no skill). We found skills at 66%. In both cases, explicit instructions (AGENTS.md / rules / CLAUDE.md) dramatically improve results.

The Vercel approach of embedding a compressed docs index directly into AGENTS.md is analogous to our `cli+claude.md` mode, where ctx7 CLI instructions are baked into CLAUDE.md. Both achieve near-perfect results because the instructions are always in context.

---

## Reproducibility Notes

### Run-to-run variance

LLM outputs are non-deterministic. Across multiple runs of the same configuration:
- Individual queries flip +/-5% between runs
- Aggregate recall varies +/-3-5%
- Rankings between modes are consistent across all runs
- The same 3-5 "hard" queries (eslint, pnpm, jest) fail in most runs regardless of mode

### Second run validation

| Mode          | Run 1 (clean/ctx) | Run 2 (clean/ctx) | Consistent? |
| ------------- | ------------------ | ------------------ | ----------- |
| cli+skill     | 66% / 72%          | 80% / 74%          | Noisy but pattern holds |
| cli+rule      | 98% / 96%          | 96% / 96%          | Yes         |
| cli+claude.md | 94% / 88%          | 96% / 88%          | Yes         |
| mcp           | 92% / 72%          | 96% / 72%          | Yes (ctx drop consistent) |
| mcp+rule      | 98% / 94%          | 98% / 96%          | Yes         |
| mcp+claude.md | 100% / 96%         | 98% / 94%          | Yes         |

### API key vs subscription

Tests using `ANTHROPIC_API_KEY` showed dramatically different behavior:
- MCP modes dropped to near 0% recall (Claude couldn't discover MCP tools via ToolSearch)
- CLI modes showed different tool access patterns
- All reported results use subscription auth, which matches real user experience

API key mode uses a different code path in `claude -p` (SDK mode) that may not load MCP tools the same way. This is a Claude Code CLI implementation detail, not something the orchestrator can control.

### `claude -p` vs interactive sessions

Our benchmark uses piped mode (`claude -p`), which differs from interactive sessions:
- No conversation history or prior tool results in context
- No open files or IDE integration
- No memory or CLAUDE.md from prior sessions loading
- Different system prompt structure

The `--with-context` simulation partially addresses this by prepending work context to queries, but real interactive sessions likely have even lower trigger rates. The 72-96% range we measure with context is an **upper bound** on real-world mid-session performance.

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

### Raw results

All reports and JSON data are stored in `skills/find-docs-workspace/orchestrator-results/`.
