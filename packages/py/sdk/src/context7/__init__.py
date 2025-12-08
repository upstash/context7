"""
Context7 Python SDK - Documentation retrieval for AI agents.

This SDK provides a simple interface to search for libraries and retrieve
documentation from Context7, optimized for AI agents and LLMs.

Example:
    ```python
    import asyncio
    from context7 import Context7

    async def main():
        async with Context7(api_key="ctx7sk_...") as client:
            # Search for libraries
            results = await client.search_library("react")

            # Get documentation
            docs = await client.get_docs("/facebook/react")

    asyncio.run(main())
    ```
"""

from context7.client import Context7
from context7.errors import Context7APIError, Context7Error, Context7ValidationError
from context7.models import (
    APIResponseMetadata,
    AuthenticationType,
    CodeDocsResponse,
    CodeExample,
    CodeSnippet,
    DocsResponse,
    DocsResponseBase,
    GetDocsOptions,
    InfoDocsResponse,
    InfoSnippet,
    LibraryState,
    Pagination,
    SearchLibraryResponse,
    SearchResult,
    TextDocsResponse,
)

__all__ = [
    # Client
    "Context7",
    # Errors
    "Context7Error",
    "Context7APIError",
    "Context7ValidationError",
    # Models - Search
    "SearchResult",
    "SearchLibraryResponse",
    "APIResponseMetadata",
    # Models - Docs
    "CodeSnippet",
    "CodeExample",
    "InfoSnippet",
    "Pagination",
    "DocsResponseBase",
    "CodeDocsResponse",
    "InfoDocsResponse",
    "TextDocsResponse",
    "DocsResponse",
    "GetDocsOptions",
    # Enums
    "LibraryState",
    "AuthenticationType",
]

__version__ = "0.1.0"
