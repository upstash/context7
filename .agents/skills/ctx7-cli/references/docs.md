# Documentation Commands

Fetch current library documentation from Context7. Two-step workflow: resolve the library name to get its ID, then query docs using that ID. If the user already provided a library ID in `/org/project` or `/org/project/version` format, pass it directly to `ctx7 docs`.

## Step 1: Resolve a Library

```bash
ctx7 library react
ctx7 library nextjs "app router setup"
ctx7 library prisma "database relations"
```

Always pass a `query` argument that reflects what the user is trying to do — it ranks results by relevance and helps disambiguate when multiple libraries share a similar name.

### Picking the right result

When multiple results are returned, select based on this priority order:

1. **Name match** — exact or closest match to what the user asked for
2. **Description relevance** — does the description match the user's intent?
3. **Snippet count** — more snippets means more indexed documentation; prefer higher counts
4. **Source reputation** — prefer High or Medium reputation over Unknown
5. **Benchmark score** — higher is better (100 is the maximum)

If multiple results look equally good, pick the most relevant one and proceed — don't call `ctx7 library` repeatedly trying to find a perfect match. Use the best result you have.

### Version-specific IDs

If the user mentions a specific version, use a version-specific library ID:

```bash
# General (latest indexed)
ctx7 docs /vercel/next.js "app router"

# Version-specific
ctx7 docs /vercel/next.js/v14.3.0-canary.87 "app router"
```

The available versions are listed in the `ctx7 library` output. Use the closest match to what the user specified.

```bash
# Output as JSON for scripting
ctx7 library react --json | jq '.[0].id'
```

## Step 2: Query Documentation

```bash
ctx7 docs /facebook/react "useEffect cleanup"
ctx7 docs /vercel/next.js "middleware authentication"
ctx7 docs /prisma/prisma "one-to-many relations"
```

### Writing good queries

The query directly affects the quality of results. Be specific and include context:

| Quality | Example |
|---------|---------|
| Good | `"How to set up authentication with JWT in Express.js"` |
| Good | `"React useEffect cleanup function with async operations"` |
| Bad | `"auth"` |
| Bad | `"hooks"` |

Use the user's full question as the query when possible — vague one-word queries return generic results.

The output contains two types of content: **code snippets** (titled, with language-tagged blocks) and **info snippets** (prose explanations with breadcrumb context).

```bash
# Output as structured JSON
ctx7 docs /facebook/react "hooks" --json

# Pipe to other tools — output is clean when not in a TTY (no spinners or colors)
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
