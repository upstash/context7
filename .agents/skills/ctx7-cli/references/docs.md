# Documentation Commands

Fetch current library documentation from Context7. Two-step workflow: resolve the library name to get its ID, then query docs using that ID.

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

## Piping

Output is clean (no spinners or colors) when piped to another command:

```bash
ctx7 docs /facebook/react "hooks" | head -50
ctx7 docs /vercel/next.js "routing" | grep -A5 "middleware"
```

## Authentication

Works without authentication. For higher rate limits:

```bash
# Option A: environment variable
export CONTEXT7_API_KEY=your_key

# Option B: OAuth login
ctx7 login
```
