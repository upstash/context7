# find-docs Skill Evaluation Report

**Date:** 2026-03-18
**Skill:** `find-docs` (ctx7 CLI documentation lookup)
**Model:** claude-opus-4-6

---

## 1. Triggering Analysis

### Problem
Users report the skill rarely triggers for technical questions unless they explicitly say "find docs" or "check docs."

### Methodology
- Created 20 eval queries (11 should-trigger, 9 should-not-trigger)
- Ran the description optimization loop (5 iterations, 3 runs per query per iteration = 300 total runs)
- Tested 5 different description variants from passive to aggressive

### Results

| Iteration | Description Style | Train Recall | Test Recall | Precision |
|-----------|------------------|-------------|-------------|-----------|
| 1 | Original (passive, "prefer when accuracy matters") | 5% | 0% | 100% |
| 2 | Assertive + named libraries (React, Prisma, etc.) | 0% | 0% | 100% |
| 3 | Original style reverted | 5% | 0% | 100% |
| 4 | "MUST be used" + explicit trigger examples | 0% | 0% | 100% |
| 5 | "MUST be used" + named technologies + Django | 0% | 0% | 100% |

Total triggers: 2 out of 300 should-trigger runs (0.7%).

### Conclusion
Description wording has no measurable effect on triggering. The model's heuristic to answer technical questions directly (without consulting skills) is a model-level behavior, not a description-quality problem. The original description is fine as-is.

### Recommendations
- **MCP approach:** The `context7-mcp` skill uses native MCP tools (`resolve-library-id`, `query-docs`) which may trigger more reliably than a skill that instructs running CLI commands via Bash.
- **Platform-level fix:** The triggering threshold for skills in Claude Code could be lowered for documentation-type skills.
- **User workaround:** Users can invoke `/find-docs` directly or mention "check the docs" explicitly.

---

## 2. Skill Content Evaluation

### Methodology
- 3 test cases run with-skill and without-skill (baseline from training knowledge)
- Graded against 4 assertions per with-skill run, 2 per baseline

### Test Cases

| Eval | Topic | With-Skill | Baseline | Time (skill) | Time (baseline) | Tokens (skill) | Tokens (baseline) |
|------|-------|-----------|----------|-------------|----------------|----------------|-------------------|
| 1 | Next.js 15 + Drizzle ORM multi-library | 4/4 pass | 2/2 pass | 143s | 54s | 22,500 | 11,145 |
| 2 | React 19 useFormStatus migration | 4/4 pass | 2/2 pass | 115s | 52s | 19,562 | 10,607 |
| 3 | Tailwind CSS v4 config debugging | 4/4 pass | 2/2 pass | 97s | 41s | 18,318 | 10,297 |

### Key Findings

**a. Both versions produce correct answers for well-known topics.**
The model's training data covers React 19, Next.js 15, and Tailwind v4 well enough that baseline answers are also accurate. The skill's value is stronger for niche or very recent libraries.

**b. With-skill is 2.4x slower and 1.9x more tokens.**
Average: 118s / 20k tokens (skill) vs 49s / 11k tokens (baseline).

**c. The 3-command limit is too rigid for multi-library queries.**
Eval 1 required 5 ctx7 commands because searching "nextjs" didn't find `/vercel/next.js` -- needed retry with "next.js". A second agent run on the same eval used 7 commands.

**d. Library name resolution is fragile.**
- "nextjs" returns CDK constructs and templates, not official Vercel repo
- "next.js" (with dot) correctly finds `/vercel/next.js`
- "tailwindcss" returns Rails/React Native plugins
- "tailwind css" (with space) correctly finds official docs

### Content Improvement Recommendations

1. **Increase command limit for multi-library queries.** Change "Do not run these commands more than 3 times" to "Limit to 3 commands per library. For questions spanning multiple libraries, you may run up to 6 total."

2. **Add library name resolution tips.** Add a section like:
   ```
   If the first search doesn't return the official library, try:
   - The full name with punctuation (e.g., "next.js" not "nextjs")
   - The name with spaces (e.g., "tailwind css" not "tailwindcss")
   - The organization name (e.g., "vercel next" or "drizzle orm")
   ```

3. **Add multi-library guidance.** Mention that for questions involving 2+ libraries, resolve and query each one separately.

---

## 3. Eval Infrastructure Notes

The skill-creator's `run_eval.py` has a bug when testing skills that are already installed: it creates a temp command file (`find-docs-skill-<uuid>`) but the real `find-docs` skill shadows it. Claude invokes the real skill, which the script doesn't detect. Workaround: temporarily rename the real skill before running the optimizer.

---

## Files

- Eval workspace: `skills/find-docs-workspace/`
- Iteration 1 outputs: `skills/find-docs-workspace/iteration-1/`
- Trigger eval set: `skills/find-docs-workspace/trigger-eval.json`
- Trigger test results: `skills/find-docs-workspace/trigger-results.jsonl`
- Benchmark: `skills/find-docs-workspace/iteration-1/benchmark.json`
