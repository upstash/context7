---
name: ctx7-cli
description: Fetch up-to-date library documentation using the ctx7 CLI. Use this skill whenever you need current docs for any library, framework, or package — especially when writing code that depends on a specific API, verifying function signatures, checking configuration options, or when training data may be outdated. Also use when the user mentions "ctx7", "context7", library documentation, or asks you to look up how a library works.
---

# ctx7 CLI

Fetch current library documentation from Context7 directly in the terminal. Two-step workflow: resolve the library name, then query its docs.

## Quick Reference

```bash
# Step 1: Find the library ID
ctx7 library <name> [query] [--json]

# Step 2: Fetch docs using the ID
ctx7 docs <libraryId> <query> [--json]
```

Run with `npx ctx7` (no install needed) or install globally with `npm install -g ctx7`.

## Step 1: Resolve a Library

Search by name to get the Context7 library ID. The optional `query` argument ranks results by relevance to your task.

```bash
ctx7 library react
ctx7 library nextjs "app router setup"
ctx7 library prisma "database relations"
```

**Example 1:**
Input: `ctx7 library react`
Output: A numbered list with library ID (`/facebook/react`), snippet count, stars, trust score, and versions.

**Example 2:**
Input: `ctx7 library nextjs "app router setup"`
Output: Results ranked by relevance to "app router setup". The top result's ID is what you pass to `ctx7 docs`.

Use `--json` to get raw JSON (useful for scripting):
```bash
ctx7 library react --json | jq '.[0].id'
```

## Step 2: Query Documentation

Pass the library ID (starts with `/`) and a question to fetch relevant code snippets and explanations.

```bash
ctx7 docs /facebook/react "useEffect cleanup"
ctx7 docs /vercel/next.js "middleware authentication"
ctx7 docs /prisma/prisma "one-to-many relations"
```

**Example 1:**
Input: `ctx7 docs /facebook/react "useEffect cleanup"`
Output: Code snippets showing useEffect cleanup patterns, plus explanatory info snippets.

**Example 2:**
Input: `ctx7 docs /vercel/next.js "middleware"`
Output: Middleware configuration examples with code blocks and descriptions.

Use `--json` to get structured output:
```bash
ctx7 docs /facebook/react "hooks" --json
```

## Authentication

Works without authentication. For higher rate limits:

```bash
# Option A: API key
export CONTEXT7_API_KEY=your_key

# Option B: OAuth login
ctx7 login
```

## Piping

Output is clean (no spinners or colors) when piped to another command:

```bash
ctx7 docs /facebook/react "hooks" | head -50
```

## Common Mistakes

- Forgetting the `/` prefix on library IDs — `/facebook/react` not `facebook/react`
- Skipping step 1 — always resolve first to get the correct ID
- Using a library name where an ID is expected — `ctx7 docs react "hooks"` will fail; use the full ID from `ctx7 library`
