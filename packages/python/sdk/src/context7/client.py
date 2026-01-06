"""Main Context7 client for interacting with the Context7 API."""

from __future__ import annotations

import os
import warnings
from typing import Any, Literal, overload

from context7.errors import Context7Error
from context7.http import HttpClient
from context7.models import (
    ApiCodeSnippet,
    ApiContextJsonResponse,
    ApiInfoSnippet,
    ApiSearchResult,
    Documentation,
    Library,
)

DEFAULT_BASE_URL = "https://context7.com/api"
API_KEY_PREFIX = "ctx7sk"


def _validate_api_key(api_key: str | None) -> str:
    """Validate and resolve the API key."""
    resolved_api_key = api_key or os.environ.get("CONTEXT7_API_KEY")

    if not resolved_api_key:
        raise Context7Error(
            "API key is required. Pass it in the constructor or set "
            "CONTEXT7_API_KEY environment variable."
        )

    if not resolved_api_key.startswith(API_KEY_PREFIX):
        warnings.warn(
            f"API key should start with '{API_KEY_PREFIX}'",
            UserWarning,
            stacklevel=3,
        )

    return resolved_api_key


def _format_code_snippet(snippet: ApiCodeSnippet) -> Documentation:
    """Format a code snippet into a Documentation object."""
    code_blocks = "\n\n".join(
        f"```{item.get('language', '')}\n{item.get('code', '')}\n```" for item in snippet.code_list
    )
    content = f"{snippet.code_description}\n\n{code_blocks}"

    return Documentation(
        title=snippet.code_title,
        content=content,
        source=snippet.page_title or snippet.code_id,
    )


def _format_info_snippet(snippet: ApiInfoSnippet) -> Documentation:
    """Format an info snippet into a Documentation object."""
    return Documentation(
        title=snippet.breadcrumb or "Documentation",
        content=snippet.content,
        source=snippet.page_id,
    )


def _format_library(result: ApiSearchResult) -> Library:
    """Format an API search result into a Library object."""
    return Library(
        id=result.id,
        name=result.title,
        description=result.description,
        total_snippets=result.total_snippets or 0,
        trust_score=result.trust_score or 0.0,
        benchmark_score=result.benchmark_score or 0.0,
        versions=result.versions,
    )


def _process_context_response(
    result: str | dict[str, Any],
    response_type: Literal["json", "txt"],
) -> str | list[Documentation]:
    """Process the context API response based on type."""
    if response_type == "txt":
        if isinstance(result, str):
            return result
        return ""

    # Parse JSON response
    api_response = ApiContextJsonResponse.model_validate(result)

    docs: list[Documentation] = []
    for code_snippet in api_response.code_snippets:
        docs.append(_format_code_snippet(code_snippet))
    for info_snippet in api_response.info_snippets:
        docs.append(_format_info_snippet(info_snippet))

    return docs


class Context7:
    """
    Context7 Python SDK client.

    The Context7 client provides methods to search for libraries and retrieve
    documentation optimized for AI agents and LLMs.

    Synchronous Usage:
        ```python
        from context7 import Context7

        # Initialize with API key (or set CONTEXT7_API_KEY env var)
        with Context7(api_key="ctx7sk_...") as client:
            # Search for libraries
            libraries = client.search_library("I need a UI library", "react")
            for lib in libraries:
                print(f"{lib.id}: {lib.name}")

            # Get documentation context
            context = client.get_context("How to use hooks", "/facebook/react")
            print(context)
        ```

    Asynchronous Usage:
        ```python
        import asyncio
        from context7 import Context7

        async def main():
            async with Context7(api_key="ctx7sk_...") as client:
                # Search for libraries
                libraries = await client.search_library_async(
                    "I need a UI library", "react"
                )
                for lib in libraries:
                    print(f"{lib.id}: {lib.name}")

                # Get documentation context
                context = await client.get_context_async(
                    "How to use hooks", "/facebook/react"
                )
                print(context)

        asyncio.run(main())
        ```
    """

    def __init__(
        self,
        api_key: str | None = None,
        base_url: str | None = None,
    ) -> None:
        """
        Initialize the Context7 client.

        Args:
            api_key: API key for authentication. Falls back to CONTEXT7_API_KEY
                environment variable if not provided.
            base_url: Optional custom base URL for the API. Defaults to
                https://context7.com/api.

        Raises:
            Context7Error: If no API key is provided or found in environment.
        """
        resolved_api_key = _validate_api_key(api_key)
        http_headers = {"Authorization": f"Bearer {resolved_api_key}"}
        resolved_base_url = base_url or DEFAULT_BASE_URL

        self._http = HttpClient(
            base_url=resolved_base_url,
            headers=http_headers,
        )

    # Sync context manager
    def __enter__(self) -> Context7:
        """Enter sync context manager."""
        return self

    def __exit__(self, *args: object) -> None:
        """Exit sync context manager and close connections."""
        self.close()

    # Async context manager
    async def __aenter__(self) -> Context7:
        """Enter async context manager."""
        return self

    async def __aexit__(self, *args: object) -> None:
        """Exit async context manager and close connections."""
        await self.close_async()

    def close(self) -> None:
        """Close the sync HTTP client connection."""
        self._http.close()

    async def close_async(self) -> None:
        """Close the async HTTP client connection."""
        await self._http.close_async()

    # Synchronous methods
    def search_library(self, query: str, library_name: str) -> list[Library]:
        """
        Search for libraries matching the given query.

        Args:
            query: The user's question or task (used for relevance ranking).
            library_name: The library name to search for.

        Returns:
            List of matching libraries.

        Example:
            ```python
            libraries = client.search_library("I need a UI library", "react")
            for lib in libraries:
                print(f"{lib.id}: {lib.name} ({lib.total_snippets} snippets)")
            ```
        """
        result, _ = self._http.request(
            method="GET",
            path=["v2", "libs", "search"],
            query={"query": query, "libraryName": library_name},
        )
        api_results = [ApiSearchResult.model_validate(item) for item in result["results"]]
        return [_format_library(r) for r in api_results]

    @overload
    def get_context(
        self,
        query: str,
        library_id: str,
        *,
        type: Literal["txt"] = "txt",  # pylint: disable=redefined-builtin
    ) -> str: ...

    @overload
    def get_context(
        self,
        query: str,
        library_id: str,
        *,
        type: Literal["json"],  # pylint: disable=redefined-builtin
    ) -> list[Documentation]: ...

    def get_context(
        self,
        query: str,
        library_id: str,
        *,
        type: Literal["json", "txt"] = "txt",  # pylint: disable=redefined-builtin
    ) -> str | list[Documentation]:
        """
        Get documentation context for a library.

        Args:
            query: The user's question or task.
            library_id: Context7 library ID (e.g., "/facebook/react").
            type: Response format:
                - "txt": Plain text documentation (default)
                - "json": List of Documentation objects

        Returns:
            Documentation as string (txt) or list of Documentation objects (json).

        Example:
            ```python
            # Get context as text (default)
            context = client.get_context("How to use hooks", "/facebook/react")
            print(context)

            # Get context as structured data
            docs = client.get_context(
                "How to use hooks",
                "/facebook/react",
                type="json"
            )
            for doc in docs:
                print(f"{doc.title}: {doc.content[:100]}...")
            ```
        """
        result, _ = self._http.request(
            method="GET",
            path=["v2", "context"],
            query={
                "query": query,
                "libraryId": library_id,
                "type": type,
            },
        )
        return _process_context_response(result, type)

    # Asynchronous methods
    async def search_library_async(self, query: str, library_name: str) -> list[Library]:
        """
        Search for libraries matching the given query (async version).

        Args:
            query: The user's question or task (used for relevance ranking).
            library_name: The library name to search for.

        Returns:
            List of matching libraries.

        Example:
            ```python
            libraries = await client.search_library_async(
                "I need a UI library", "react"
            )
            for lib in libraries:
                print(f"{lib.id}: {lib.name} ({lib.total_snippets} snippets)")
            ```
        """
        result, _ = await self._http.request_async(
            method="GET",
            path=["v2", "libs", "search"],
            query={"query": query, "libraryName": library_name},
        )
        api_results = [ApiSearchResult.model_validate(item) for item in result["results"]]
        return [_format_library(r) for r in api_results]

    @overload
    async def get_context_async(
        self,
        query: str,
        library_id: str,
        *,
        type: Literal["txt"] = "txt",  # pylint: disable=redefined-builtin
    ) -> str: ...

    @overload
    async def get_context_async(
        self,
        query: str,
        library_id: str,
        *,
        type: Literal["json"],  # pylint: disable=redefined-builtin
    ) -> list[Documentation]: ...

    async def get_context_async(
        self,
        query: str,
        library_id: str,
        *,
        type: Literal["json", "txt"] = "txt",  # pylint: disable=redefined-builtin
    ) -> str | list[Documentation]:
        """
        Get documentation context for a library (async version).

        Args:
            query: The user's question or task.
            library_id: Context7 library ID (e.g., "/facebook/react").
            type: Response format:
                - "txt": Plain text documentation (default)
                - "json": List of Documentation objects

        Returns:
            Documentation as string (txt) or list of Documentation objects (json).

        Example:
            ```python
            # Get context as text (default)
            context = await client.get_context_async(
                "How to use hooks", "/facebook/react"
            )
            print(context)

            # Get context as structured data
            docs = await client.get_context_async(
                "How to use hooks",
                "/facebook/react",
                type="json"
            )
            for doc in docs:
                print(f"{doc.title}: {doc.content[:100]}...")
            ```
        """
        result, _ = await self._http.request_async(
            method="GET",
            path=["v2", "context"],
            query={
                "query": query,
                "libraryId": library_id,
                "type": type,
            },
        )
        return _process_context_response(result, type)
