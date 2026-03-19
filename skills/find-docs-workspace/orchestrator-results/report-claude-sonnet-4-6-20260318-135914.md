# Trigger Eval Report

- **Model:** claude-sonnet-4-6
- **Date:** 2026-03-18 13:59
- **Eval set:** trigger-eval.json

## Summary

| Mode | Recall | Precision | False Pos | Time |
|------|--------|-----------|-----------|------|
| mcp | 8/11 (73%) | 8/8 (100%) | 0 | 53.4s |
| mcp+rule | 11/11 (100%) | 11/11 (100%) | 0 | 28.0s |
| skill | 10/11 (91%) | 10/10 (100%) | 0 | 44.0s |

## mcp

### Should Trigger

| # | Triggered | First Tool | Query |
|---|-----------|------------|-------|
| 1 | no | - | How do I use useEffect to fetch data in React? |
| 2 | no | - | What is the Prisma syntax for defining a one-to-many relation with cas |
| 3 | no | - | How do React hooks work? |
| 4 | yes | Agent | I'm trying to set up SvelteKit's new runes system but the $state synta |
| 5 | yes | ToolSearch(resolve-library-id mcp context7) | We just upgraded to Drizzle ORM 0.35 and our existing .onConflictDoUpd |
| 6 | yes | ToolSearch(resolve-library-id mcp__context7) | How does the new Bun.serve() API handle WebSocket upgrades? I saw some |
| 7 | yes | ToolSearch(mcp__context7__resolve-library-id) | Can you write me a tRPC router that handles file uploads with presigne |
| 8 | yes | Agent | I need to add rate limiting to my Hono.js API. What middleware options |
| 9 | yes | ToolSearch(resolve library id) | What's the correct way to set up Turborepo's new daemon mode? Our CI i |
| 10 | yes | Agent | Show me how to use Tanstack Query v5's useSuspenseQuery - I keep getti |
| 11 | yes | ToolSearch(mcp__context7__resolve-library-id) | My Playwright tests are flaky because of some timing issue with their  |

### Should NOT Trigger

| # | Triggered | First Tool | Query |
|---|-----------|------------|-------|
| 12 | no | - | Can you refactor this function to use async/await instead of callbacks |
| 13 | no | - | Write me a Python script that reads a CSV and outputs a summary of eac |
| 14 | no | - | I have a bug where my React component re-renders infinitely. Here's th |
| 15 | no | - | Help me write unit tests for this Express middleware that checks JWT t |
| 16 | no | - | Can you optimize this SQL query? It's doing a full table scan and I th |
| 17 | no | - | Convert this JavaScript class component to a functional component with |
| 18 | no | Write | I need a bash script that monitors disk usage and sends a Slack notifi |
| 19 | no | - | Review this PR diff and tell me if there are any security issues: [dif |
| 20 | no | Agent | Help me set up a GitHub Actions workflow that runs my tests on every P |

## mcp+rule

### Should Trigger

| # | Triggered | First Tool | Query |
|---|-----------|------------|-------|
| 1 | yes | ToolSearch(select:mcp__context7__resolve-library-id) | How do I use useEffect to fetch data in React? |
| 2 | yes | ToolSearch(select:mcp__context7__resolve-library-id) | What is the Prisma syntax for defining a one-to-many relation with cas |
| 3 | yes | ToolSearch(select:mcp__context7__resolve-library-id) | How do React hooks work? |
| 4 | yes | ToolSearch(resolve-library-id query-docs) | I'm trying to set up SvelteKit's new runes system but the $state synta |
| 5 | yes | ToolSearch(resolve-library-id query-docs) | We just upgraded to Drizzle ORM 0.35 and our existing .onConflictDoUpd |
| 6 | yes | ToolSearch(select:mcp__context7__resolve-library-id) | How does the new Bun.serve() API handle WebSocket upgrades? I saw some |
| 7 | yes | ToolSearch(resolve-library-id query-docs) | Can you write me a tRPC router that handles file uploads with presigne |
| 8 | yes | ToolSearch(select:mcp__context7__resolve-library-id) | I need to add rate limiting to my Hono.js API. What middleware options |
| 9 | yes | ToolSearch(select:mcp__context7__resolve-library-id) | What's the correct way to set up Turborepo's new daemon mode? Our CI i |
| 10 | yes | ToolSearch(select:mcp__context7__resolve-library-id) | Show me how to use Tanstack Query v5's useSuspenseQuery - I keep getti |
| 11 | yes | ToolSearch(resolve-library-id) | My Playwright tests are flaky because of some timing issue with their  |

### Should NOT Trigger

| # | Triggered | First Tool | Query |
|---|-----------|------------|-------|
| 12 | no | - | Can you refactor this function to use async/await instead of callbacks |
| 13 | no | - | Write me a Python script that reads a CSV and outputs a summary of eac |
| 14 | no | - | I have a bug where my React component re-renders infinitely. Here's th |
| 15 | no | - | Help me write unit tests for this Express middleware that checks JWT t |
| 16 | no | - | Can you optimize this SQL query? It's doing a full table scan and I th |
| 17 | no | - | Convert this JavaScript class component to a functional component with |
| 18 | no | Write | I need a bash script that monitors disk usage and sends a Slack notifi |
| 19 | no | - | Review this PR diff and tell me if there are any security issues: [dif |
| 20 | no | Bash | Help me set up a GitHub Actions workflow that runs my tests on every P |

## skill

### Should Trigger

| # | Triggered | First Tool | Query |
|---|-----------|------------|-------|
| 1 | yes | Skill(find-docs) | How do I use useEffect to fetch data in React? |
| 2 | yes | Skill(find-docs) | What is the Prisma syntax for defining a one-to-many relation with cas |
| 3 | no | - | How do React hooks work? |
| 4 | yes | Skill(find-docs) | I'm trying to set up SvelteKit's new runes system but the $state synta |
| 5 | yes | Skill(find-docs) | We just upgraded to Drizzle ORM 0.35 and our existing .onConflictDoUpd |
| 6 | yes | Skill(find-docs) | How does the new Bun.serve() API handle WebSocket upgrades? I saw some |
| 7 | yes | Skill(find-docs) | Can you write me a tRPC router that handles file uploads with presigne |
| 8 | yes | Skill(find-docs) | I need to add rate limiting to my Hono.js API. What middleware options |
| 9 | yes | Skill(find-docs) | What's the correct way to set up Turborepo's new daemon mode? Our CI i |
| 10 | yes | Skill(find-docs) | Show me how to use Tanstack Query v5's useSuspenseQuery - I keep getti |
| 11 | yes | Skill(find-docs) | My Playwright tests are flaky because of some timing issue with their  |

### Should NOT Trigger

| # | Triggered | First Tool | Query |
|---|-----------|------------|-------|
| 12 | no | - | Can you refactor this function to use async/await instead of callbacks |
| 13 | no | - | Write me a Python script that reads a CSV and outputs a summary of eac |
| 14 | no | - | I have a bug where my React component re-renders infinitely. Here's th |
| 15 | no | - | Help me write unit tests for this Express middleware that checks JWT t |
| 16 | no | - | Can you optimize this SQL query? It's doing a full table scan and I th |
| 17 | no | - | Convert this JavaScript class component to a functional component with |
| 18 | no | Write | I need a bash script that monitors disk usage and sends a Slack notifi |
| 19 | no | - | Review this PR diff and tell me if there are any security issues: [dif |
| 20 | no | Agent | Help me set up a GitHub Actions workflow that runs my tests on every P |
