# Context7 Skill Invocation Analysis

**Date:** 2026-03-18
**Analyst:** Claude Opus 4.6 via skill-creator
**Project:** context7 find-docs skill

---

## Executive Summary

We investigated why the `find-docs` skill rarely triggers automatically in Claude Code. Through ~1000 test runs across 3 models, ~15 description variants, 2 eval sets, and 4 different delivery mechanisms, we found that:

1. **Skill descriptions have near-zero effect on triggering.** Claude's model-level heuristic to "answer directly" overrides any description wording.
2. **MCP tools alone don't help either.** Without a rule, MCP tools trigger at the same 0% rate as skills.
3. **Rules are the key lever.** An `alwaysApply: true` rule combined with MCP tools achieves 36% recall with 100% precision.
4. The triggering gap is a model-level behavior consistent across Opus 4.6, Sonnet 4.6, and Haiku 4.5.

---

## 1. Problem Statement

Users reported that the `find-docs` skill rarely triggers unless they explicitly say "find docs" or "check docs":

> "Claude doesn't pick ctx7 skill if you are not very explicit. For example:
>
> - 'How do React hooks work?' never triggers the skill.
> - 'Docs about how React hooks work' sometimes yes, sometimes no.
> - 'Find docs about how React hooks work' almost every time loads the skill."

Claude's own reasoning when it skips the skill:

> "useEffect for data fetching is a fundamental, stable React pattern that hasn't changed meaningfully. I was confident my answer was accurate without needing to look up docs."

---

## 2. Eval Setup

### Eval Set v1 (20 queries)

**11 should-trigger queries** (library/framework questions):

- "How do I use useEffect to fetch data in React?"
- "What is the Prisma syntax for defining a one-to-many relation with cascade delete?"
- "How do React hooks work?"
- SvelteKit runes, Drizzle ORM 0.35 API changes, Bun.serve() WebSockets
- tRPC v11 file uploads, Hono.js rate limiting, Turborepo daemon mode
- Tanstack Query v5 useSuspenseQuery, Playwright auto-retrying assertions

**9 should-not-trigger queries** (general programming):

- Refactoring, Python scripting, debugging React re-renders
- Unit tests, SQL optimization, code conversion
- Bash scripting, PR review, GitHub Actions setup

### Eval Set v2 (20 queries)

Harder should-trigger queries focused on bleeding-edge features (Svelte 5 $effect.tracking(), Vite 6 Environment API, React compiler, Astro server islands, Deno 2 API) to test if Claude's uncertainty about newer features would increase triggering.

---

## 3. Skill Description Optimization

### Methodology

Used the skill-creator's `run_loop.py` optimizer:

- Creates a temp command file with the description being tested
- Runs `claude -p` with each query 3 times
- Checks if Claude invokes the Skill tool for the temp command
- Iterates up to 5 times, proposing improved descriptions based on failures

**Important setup note:** The real `find-docs` skill must be temporarily renamed/hidden during testing, otherwise Claude invokes the real skill instead of the temp command and the optimizer reports false negatives.

### Run 1: Original description (5 iterations, Opus 4.6)

| Iter | Description Style                                 | Train Recall | Test Recall |
| ---- | ------------------------------------------------- | ------------ | ----------- |
| 1    | Original passive ("prefer when accuracy matters") | 5%           | 0%          |
| 2    | Assertive + named libraries (React, Prisma, etc.) | 0%           | 0%          |
| 3    | Original style reverted                           | 5%           | 0%          |
| 4    | "MUST be used" + explicit examples                | 0%           | 0%          |
| 5    | "TRIGGER when..." + explicit DO NOT rules         | 5%           | 0%          |

### Run 2: Continued from best description (5 iterations, Opus 4.6)

| Iter | Description Style                             | Train Recall | Test Recall |
| ---- | --------------------------------------------- | ------------ | ----------- |
| 1    | "TRIGGER when..." (continued from Run 1 best) | 10%          | 8%          |
| 2    | "Look up docs for ANY named library"          | 10%          | 8%          |
| 3    | Aggressive with method signatures             | 5%           | 0%          |
| 4    | Even more aggressive                          | 5%           | 17%         |
| 5    | Refined trigger/don't-trigger                 | 5%           | 8%          |

### Cross-model comparison (3 iterations each)

| Model      | Iter 1 (Train/Test) | Iter 2 | Iter 3 | Best Test         |
| ---------- | ------------------- | ------ | ------ | ----------------- |
| Opus 4.6   | 0%/0%               | 0%/8%  | 10%/0% | 25% (earlier run) |
| Sonnet 4.6 | 0%/0%               | 10%/0% | 5%/8%  | 8%                |
| Haiku 4.5  | 0%/0%               | 5%/8%  | 0%/0%  | 8%                |

### Radical description variants (Sonnet 4.6, eval set v2)

| Description Framing                                                                 | Recall    | Precision |
| ----------------------------------------------------------------------------------- | --------- | --------- |
| A: "Fear of being wrong" -- "training data WILL contain errors, you MUST call this" | 7% (2/30) | 100%      |
| B: "Search engine" -- "Query this to search 50,000+ library docs"                   | 0%        | 100%      |
| C: "Fact-checker" -- "prevents you from giving outdated API examples"               | 0%        | 100%      |

### Conclusion on description optimization

**Description wording has no meaningful effect on triggering.** Across ~15 different descriptions (passive to aggressive, 3 radical framings), 3 models, and 2 eval sets, recall never reliably exceeded 10%. The model's heuristic to answer from training knowledge overrides any description content. Precision was always 100% -- the model never wrongly triggers on non-library queries.

---

## 4. MCP vs Skills Comparison

### MCP tools without a rule

With Context7 MCP server connected but no rule file:

| Query Type                     | Trigger Rate                 |
| ------------------------------ | ---------------------------- |
| Should-trigger (11 queries)    | 0/11 (0%)                    |
| Should-not-trigger (9 queries) | 0/9 correct (100% precision) |

**Same as skills.** MCP tools alone do not trigger more readily than skills.

### Discovery: The rule file

The `ctx7 setup` command installs three things:

1. MCP server config in `.claude.json`
2. A **rule** at `~/.claude/rules/context7.md` with `alwaysApply: true`
3. The `context7-mcp` skill

The rule is what makes interactive sessions trigger the MCP tools. Rules are treated as direct user instructions, not optional metadata like skill descriptions.

### Rule content tested

**Original rule (from ctx7 setup):**

```
When working with libraries, frameworks, or APIs -- use Context7 MCP to fetch
current documentation instead of relying on training data. This includes setup
questions, code generation, API references, and anything involving specific packages.
```

**Refined selective rule:**

```
Before answering a question about a specific library or framework's API, first
check whether the question actually needs external documentation. Only call
Context7 MCP when the user is asking about how a specific third-party library
works -- its API, syntax, configuration, version changes, or behavior.

Examples where you SHOULD call Context7: "how do I use useEffect in React",
"Prisma one-to-many syntax", "what changed in Tailwind v4"

Examples where you should NOT call Context7: refactoring code, writing scripts,
debugging logic errors, code review, SQL optimization, regex, CI/CD setup
```

### Detection bug and fix

Initial test results showed 100% recall / 0% precision for all rule variants. This was caused by a detection bug: our grep matched `resolve-library-id` in the init system message's tools list (always present when MCP is connected), not in actual tool invocations. After fixing detection to only check `tool_use` blocks in assistant messages, we got accurate results.

### Final results (fixed detection, Sonnet 4.6)

| Setup                             | Recall  | Precision | F1 Score |
| --------------------------------- | ------- | --------- | -------- |
| Skill only (no rule, no MCP)      | 0-5%    | 100%      | ~0       |
| MCP only (no rule)                | 0%      | 100%      | 0        |
| MCP + Rule (`alwaysApply: false`) | 18%     | 100%      | 31%      |
| MCP + Rule (`alwaysApply: true`)  | **36%** | **100%**  | **53%**  |

`alwaysApply: true` doubles recall compared to `alwaysApply: false`. The selective rule content successfully prevents false triggers -- 0/9 should-not-trigger queries were incorrectly triggered in the best configuration.

---

## 5. Skill Content Evaluation

### Methodology

3 test cases run with subagents: one using the skill (ctx7 CLI), one baseline (training knowledge only). Each graded against assertions.

### Results

| Eval | Topic                    | With-Skill | Baseline | Time (skill) | Time (baseline) |
| ---- | ------------------------ | ---------- | -------- | ------------ | --------------- |
| 1    | Next.js 15 + Drizzle ORM | 4/4 pass   | 2/2 pass | 143s         | 54s             |
| 2    | React 19 useFormStatus   | 4/4 pass   | 2/2 pass | 115s         | 52s             |
| 3    | Tailwind CSS v4 config   | 4/4 pass   | 2/2 pass | 97s          | 41s             |

### Key findings

- **Both versions produce correct answers** for well-known topics. The skill's value is stronger for niche or very recent libraries.
- **With-skill is 2.4x slower** (avg 118s vs 49s) and uses **1.9x more tokens** (avg 20k vs 11k).
- **3-command limit too rigid:** Eval 1 needed 5 ctx7 commands because "nextjs" didn't find `/vercel/next.js` on first try (needed "next.js" with dot).
- **Library name resolution is fragile:**
  - "nextjs" returns CDK constructs, not official Vercel repo
  - "next.js" (with dot) correctly finds `/vercel/next.js`
  - "tailwindcss" returns Rails/React Native plugins
  - "tailwind css" (with space) correctly finds official docs

---

## 6. Infrastructure Notes

### Eval script bug (skill-creator run_eval.py)

The skill-creator's `run_eval.py` creates a temp command file (`find-docs-skill-<uuid>`) and checks if Claude invokes it. When the real `find-docs` skill is already installed, Claude invokes the real skill instead, and the script reports "not triggered" (false negative).

**Workaround:** Temporarily rename the real skill directories before running the optimizer:

```bash
mv ~/.claude/skills/find-docs ~/.claude/skills/_find-docs-hidden
mv /path/to/project/skills/find-docs /path/to/project/skills/_find-docs-hidden
# ... run optimizer ...
# ... restore after ...
```

### MCP trigger detection bug

When checking if MCP tools were called via `claude -p --output-format stream-json --verbose`, the init system message lists MCP tool names in the `tools` array. A naive grep for `resolve-library-id` matches this init line, producing false positives. Detection must check for `tool_use` blocks in assistant messages only.

### 103GB temp file

Background bash commands that dump subagent transcripts can produce runaway output files. One file grew to 103GB at `/private/tmp/claude-501/.../tasks/<id>.output`. Monitor temp directory size during long eval sessions.

---

## 7. Recommendations

### For Context7 product team

1. **The MCP + rule combo is the right approach.** It achieves the best balance (36% recall, 100% precision). The rule is the critical component -- without it, neither skills nor MCP tools trigger.

2. **`ctx7 setup` should always install the rule.** The rule at `~/.claude/rules/context7.md` with `alwaysApply: true` is what makes the difference. Make sure every setup path includes it.

3. **Iterate on rule content to improve recall.** Current best is 36% -- there's room to improve. Test variations of the rule's positive examples, framing, and conditional logic.

4. **Skill content improvements (for `find-docs`):**
   - Increase command limit for multi-library queries (3 per library, up to 6 total)
   - Add library name resolution tips ("next.js" not "nextjs", "tailwind css" not "tailwindcss")
   - Add multi-library query guidance

### For Anthropic (skill triggering)

5. **The model's skill invocation threshold is too high for documentation-lookup use cases.** Skills designed for "always look this up before answering" don't work because the model's confidence in its training data overrides any description wording. This is consistent across Opus, Sonnet, and Haiku.

6. **Rules work where skills don't** because they're treated as user instructions rather than optional tool metadata. Consider whether skills should have an option to behave more like rules (e.g., a `priority: high` frontmatter field).

---

## 8. Files and Artifacts

| Path                                                       | Description                                             |
| ---------------------------------------------------------- | ------------------------------------------------------- |
| `skills/find-docs-workspace/trigger-eval.json`             | Eval set v1 (20 queries)                                |
| `skills/find-docs-workspace/trigger-eval-v2.json`          | Eval set v2 (bleeding-edge queries)                     |
| `skills/find-docs-workspace/optimizer-results/`            | Optimizer run outputs (results.json, report.html, logs) |
| `skills/find-docs-workspace/mcp-rule-trigger-results.json` | MCP + rule test results                                 |
| `skills/find-docs-workspace/iteration-1/`                  | Skill content eval outputs (with_skill / without_skill) |
| `skills/find-docs-workspace/iteration-1/benchmark.json`    | Benchmark comparison data                               |
| `skills/find-docs-workspace/test_mcp_trigger_v2.py`        | MCP trigger test script (fixed detection)               |
| `~/.claude/rules/context7.md`                              | Rule file (the key to triggering)                       |

---

## Appendix: Test Run Summary

| Test                                | Runs      | Models              | Description Variants | Result       |
| ----------------------------------- | --------- | ------------------- | -------------------- | ------------ |
| Skill description optimizer (run 1) | 300       | Opus 4.6            | 5                    | 0-5% recall  |
| Skill description optimizer (run 2) | 300       | Opus 4.6            | 5                    | 5-25% recall |
| Cross-model skill test              | 180       | Opus, Sonnet, Haiku | 3 each               | 0-10% recall |
| Radical descriptions (eval v2)      | 180       | Sonnet 4.6          | 3                    | 0-7% recall  |
| MCP without rule                    | 20        | Sonnet 4.6          | original             | 0% recall    |
| MCP + rule (alwaysApply: false)     | 20        | Sonnet 4.6          | selective            | 18% recall   |
| MCP + rule (alwaysApply: true)      | 20        | Sonnet 4.6          | selective            | 36% recall   |
| **Total test runs**                 | **~1020** |                     |                      |              |

---

---

## alwaysApply: true

Before answering a question about a specific library or framework's API, first check whether the question actually needs external documentation. Only call Context7 MCP when the user is asking about how a specific third-party library works -- its API, syntax, configuration, version changes, or behavior.

Examples where you SHOULD call Context7: "how do I use useEffect in React", "Prisma one-to-many syntax", "what changed in Tailwind v4", "Bun.serve() WebSocket upgrades"

Examples where you should NOT call Context7: refactoring code, writing scripts, debugging logic errors, code review, SQL optimization, regex, CI/CD setup, implementing algorithms, converting between coding patterns

## When you decide Context7 is needed

1. Call `resolve-library-id` with the library name and the user's question
2. Pick the best match -- prefer exact names and version-specific IDs when a version is mentioned
3. Call `query-docs` with the selected library ID and the user's question
4. Answer using the fetched docs -- include code examples and cite the version
