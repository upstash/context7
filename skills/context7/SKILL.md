---
name: Library Documentation Lookup
description: Fetch up-to-date documentation and code examples for any library or framework using Context7. Use when writing code with external libraries, setting up tools, configuring frameworks, or needing current API documentation. Triggers on mentions of library names, npm packages, framework setup, API docs, or code generation requests.
allowed-tools: mcp__plugin_dev-tools_context7__resolve-library-id, mcp__plugin_dev-tools_context7__get-library-docs
---

# Context7 - Library Documentation

Always use Context7 MCP tools automatically when generating code, performing setup, or needing library documentation. **Do not wait for explicit user requests** - proactively fetch documentation when working with external libraries.

## When to Use Context7

Use Context7 automatically in these scenarios:

- **Code Generation**: Writing code that uses external libraries or frameworks
- **Setup & Configuration**: Setting up tools, libraries, or frameworks
- **API Documentation**: Needing current API documentation for any library
- **Best Practices**: Finding up-to-date examples and patterns

## How to Use

Follow this two-step process:

### 1. Resolve Library ID
```
Use mcp__plugin_dev-tools_context7__resolve-library-id
- Pass the library/package name
- Returns Context7-compatible library ID
```

### 2. Fetch Documentation
```
Use mcp__plugin_dev-tools_context7__get-library-docs
- Pass the library ID from step 1
- Optionally specify a topic to focus on
- Returns current documentation and examples
```

### 3. Apply Documentation
Use the fetched documentation to provide accurate, up-to-date code and guidance.

## Important Notes

- Context7 works without an API key (with rate limits)
- Set `CONTEXT7_API_KEY` environment variable for higher rate limits
- Always fetch documentation before generating code with external libraries
- Prefer Context7 over relying on training data for library-specific code