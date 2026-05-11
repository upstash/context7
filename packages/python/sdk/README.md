# Context7 Python SDK

Python SDK for Context7 - Documentation retrieval for AI agents.

## Installation

```bash
pip install context7
```

Or with uv:

```bash
uv add context7
```

## Quick Start

```python
import asyncio
from context7 import Context7

async def main():
    async with Context7(api_key="ctx7sk_...") as client:
        # Search for libraries
        libraries = await client.search_library_async("I need a UI library", "react")
        for lib in libraries:
            print(f"{lib.id}: {lib.name}")

        # Get documentation context
        context = await client.get_context_async("How to use hooks", "/facebook/react")
        print(context)

asyncio.run(main())
```

## API Reference

### `Context7(api_key=None, base_url=None)`

Initialize the Context7 client.

- `api_key`: API key for authentication. Falls back to `CONTEXT7_API_KEY` environment variable.
- `base_url`: Optional custom base URL for the API.

### `client.search_library(query: str, library_name: str) -> list[Library]`

Search for libraries matching the given query.

- `query`: The user's question or task (used for relevance ranking)
- `library_name`: The library name to search for

Async version: `await client.search_library_async(query, library_name)`

### `client.get_context(query: str, library_id: str, *, type="txt") -> str | list[Documentation]`

Get documentation context for a library.

**Parameters:**

- `query`: The user's question or task
- `library_id`: Context7 library ID (e.g., `/facebook/react`)
- `type`: Response format - `"txt"` (default) returns plain text, `"json"` returns list of Documentation objects

Async version: `await client.get_context_async(query, library_id, type=...)`

## License

MIT
