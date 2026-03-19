# Iteration 1: MCP+Rule vs CLI+Skill Trigger Comparison

**Date:** 2026-03-18
**Eval set:** trigger-eval.json (20 queries: 11 should-trigger, 9 should-not-trigger)
**Max turns:** 4
**Test mode:** `claude -p` with parallel execution (10 workers)

---

## Summary

| Setup | Model | Recall | Precision | F1 | False Triggers | Time |
|-------|-------|--------|-----------|-----|----------------|------|
| **MCP + Rule** (skills hidden) | Opus 4.6 | **100%** (11/11) | **100%** (11/11) | **100%** | 0/9 | 41s |
| **MCP + Rule** (skills hidden) | Sonnet 4.6 | **100%** (11/11) | **100%** (11/11) | **100%** | 0/9 | 74s |
| **CLI + Skill** (no MCP, no rule) | Opus 4.6 | 82% (9/11) | **100%** (9/9) | 90% | 0/9 | 47s |
| **CLI + Skill** (no MCP, no rule) | Sonnet 4.6 | **100%** (11/11) | 92% (11/12) | 96% | 1/9 | 58s |

---

## Configuration Details

### MCP + Rule (skills hidden)

- Context7 MCP server connected (project-level in `.claude.json`)
- Rule at `~/.claude/rules/context7.md` with `alwaysApply: true`
- `find-docs` and `context7-mcp` skills **hidden** (renamed to `_*-hidden`)
- No competing skill paths -- Claude can only use MCP tools

**Rule content:**
```markdown
---
alwaysApply: true
---

Before answering a question about a specific library or framework's API, first
check whether the question actually needs external documentation. Only call
Context7 MCP when the user is asking about how a specific third-party library
works -- its API, syntax, configuration, version changes, or behavior.

Examples where you SHOULD call Context7: "how do I use useEffect in React",
"Prisma one-to-many syntax", "what changed in Tailwind v4", "Bun.serve()
WebSocket upgrades"

Examples where you should NOT call Context7: refactoring code, writing scripts,
debugging logic errors, code review, SQL optimization, regex, CI/CD setup,
implementing algorithms, converting between coding patterns

## When you decide Context7 is needed

1. Call `resolve-library-id` with the library name and the user's question
2. Pick the best match -- prefer exact names and version-specific IDs when mentioned
3. Call `query-docs` with the selected library ID and the user's question
4. Answer using the fetched docs -- include code examples and cite the version
```

### CLI + Skill (no MCP, no rule)

- No MCP server connected
- No rule file
- `find-docs` and `context7-mcp` skills **active** in `~/.claude/skills/`
- Claude decides whether to invoke skills based on skill descriptions alone

---

## Per-Query Breakdown

### Should-Trigger Queries

| Query | MCP+Rule Opus | MCP+Rule Sonnet | CLI+Skill Opus | CLI+Skill Sonnet |
|-------|:---:|:---:|:---:|:---:|
| How do I use useEffect to fetch data in React? | + | + | **-** | + |
| What is the Prisma syntax for a one-to-many relation with cascade delete? | + | + | + | + |
| How do React hooks work? | + | + | **-** | + |
| SvelteKit's new runes system ($state syntax, v5.2) | + | + | + | + |
| Drizzle ORM 0.35 .onConflictDoUpdate() type errors | + | + | + | + |
| Bun.serve() API WebSocket upgrades | + | + | + | + |
| tRPC router with file uploads (v11) | + | + | + | + |
| Hono.js rate limiting middleware | + | + | + | + |
| Turborepo daemon mode / persistent cache | + | + | + | + |
| Tanstack Query v5 useSuspenseQuery | + | + | + | + |
| Playwright auto-retrying assertions (expect().toBeVisible()) | + | + | + | + |

### Should-NOT-Trigger Queries

| Query | MCP+Rule Opus | MCP+Rule Sonnet | CLI+Skill Opus | CLI+Skill Sonnet |
|-------|:---:|:---:|:---:|:---:|
| Refactor function to async/await | . | . | . | . |
| Python script to rename files lowercase | . | . | . | . |
| Debug infinite re-render in React component | . | . | . | . |
| Write unit tests for Express JWT middleware | . | . | . | . |
| Optimize SQL query (full table scan) | . | . | . | . |
| Convert class component to functional | . | . | . | . |
| Bash script for disk usage monitoring | . | . | . | . |
| Review PR diff for security issues | . | . | . | . |
| GitHub Actions workflow for Node.js monorepo | . | . | . | **!** |

Legend: `+` = correctly triggered, `-` = missed (should have triggered), `.` = correctly skipped, `!` = false trigger

---

## Analysis

### MCP + Rule strengths

- **Perfect recall on both models.** The rule ensures Claude always considers calling MCP tools for library questions, even simple ones like "How do React hooks work?"
- **Perfect precision.** The selective rule content ("Examples where you should NOT call Context7") prevents false triggers on non-library queries.
- **Consistent across models.** Both Opus and Sonnet achieved 20/20.

### CLI + Skill strengths

- **High recall without any rule.** Skills alone achieved 82-100% recall with `max-turns 4` -- much higher than the 0-5% we measured earlier with `max-turns 1-2`.
- **The `max-turns` setting was the main bottleneck in earlier tests.** With only 1-2 turns, Claude couldn't complete the Skill invocation flow (Skill call -> skill body loaded -> decide to use it). With 4 turns, skills work much better.

### CLI + Skill weaknesses

- **Opus misses the simplest queries.** "How do React hooks work?" and "How do I use useEffect?" didn't trigger -- these are the queries where Claude is most confident in its training data.
- **Sonnet had 1 false trigger.** The GitHub Actions query triggered the skill, likely because it mentions "Node.js" which the skill description associates with library documentation.

### Key insight: max-turns matters enormously

Earlier tests with `max-turns 1-2` showed 0-5% recall for skills. With `max-turns 4`:
- CLI+Skill jumps to 82-100% recall
- The skill invocation flow needs multiple turns: `Skill` call (turn 1) -> skill body loads -> Claude decides to call `ctx7` via `Bash` (turn 2) -> etc.

This means the earlier finding of "skills never trigger" was partially an artifact of insufficient turns, not purely a model behavior issue.

### Why MCP+Rule still wins

1. **Simpler invocation path.** MCP tool call is 1 turn (after ToolSearch). Skill invocation is 2+ turns (Skill call -> read body -> Bash call).
2. **Rule provides explicit instruction.** The `alwaysApply: true` rule is treated as a user directive, carrying more weight than skill descriptions.
3. **No competing paths.** With skills hidden, Claude has exactly one way to look up docs (MCP tools). With skills present, Claude might invoke the skill OR the MCP tool, sometimes wasting turns.

---

## Recommendations

1. **For maximum reliability:** Use MCP + selective rule with `alwaysApply: true`, hide/remove the skills. This achieves 100%/100% on both models.

2. **If skills are preferred over MCP:** Ensure `max-turns` is at least 4 in any testing setup. The skill approach works well (82-100% recall) but needs enough turns to complete the invocation flow.

3. **Avoid mixing skills and MCP.** Having both creates competing paths that waste turns. Pick one delivery mechanism.

4. **The two hardest queries to trigger** are simple, well-known topics ("How do React hooks work?", "How do I use useEffect?"). The rule solves this; skills alone may not. This is the core use case from the original user feedback.

---

## Test Artifacts

| File | Description |
|------|-------------|
| `mcp-rule-claude-opus-4-6-results.json` | MCP+Rule Opus results |
| `mcp-rule-claude-sonnet-4-6-results.json` | MCP+Rule Sonnet results |
| `cli-skill-claude-opus-4-6-results.json` | CLI+Skill Opus results |
| `cli-skill-claude-sonnet-4-6-results.json` | CLI+Skill Sonnet results |
| `test_mcp_trigger_v2.py` | MCP trigger test script |
| `test_skill_trigger.py` | Skill trigger test script |
| `trigger-eval.json` | Eval set (20 queries) |
