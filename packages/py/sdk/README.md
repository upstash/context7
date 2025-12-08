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
        results = await client.search_library("react")
        for lib in results.results:
            print(f"{lib.id}: {lib.title}")

        # Get documentation
        docs = await client.get_docs("/facebook/react")
        for snippet in docs.snippets:
            print(f"{snippet.code_title}: {snippet.code_description}")

asyncio.run(main())
```

## API Reference

### `Context7(api_key=None, base_url=None)`

Initialize the Context7 client.

- `api_key`: API key for authentication. Falls back to `CONTEXT7_API_KEY` environment variable.
- `base_url`: Optional custom base URL for the API.

### `await client.search_library(query: str) -> SearchLibraryResponse`

Search for libraries by name or description.

### `await client.get_docs(library_id: str, **options) -> DocsResponse`

Get documentation for a library.

**Parameters:**

- `library_id`: Library identifier in format `/owner/repo` (e.g., `/facebook/react`)
- `version`: Optional library version (e.g., `"18.0.0"`)
- `page`: Page number for pagination
- `topic`: Filter docs by topic
- `limit`: Number of results per page
- `mode`: Type of documentation - `"code"` (default) or `"info"`
- `format`: Response format - `"json"` (default) or `"txt"`

## License

MIT
