"""Main Context7 client for interacting with the Context7 API."""

from __future__ import annotations

import os
import warnings
from typing import Literal, overload

from context7.errors import Context7Error, Context7ValidationError
from context7.http import HttpClient
from context7.models import (
    CodeDocsResponse,
    InfoDocsResponse,
    Pagination,
    SearchLibraryResponse,
    TextDocsResponse,
)

DEFAULT_BASE_URL = "https://context7.com/api"
API_KEY_PREFIX = "ctx7sk"


class Context7:
    """
    Context7 Python SDK client.

    The Context7 client provides methods to search for libraries and retrieve
    documentation optimized for AI agents and LLMs.

    Usage:
        ```python
        import asyncio
        from context7 import Context7

        async def main():
            # Initialize with API key (or set CONTEXT7_API_KEY env var)
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
                stacklevel=2,
            )

        self._http = HttpClient(
            base_url=base_url or DEFAULT_BASE_URL,
            headers={"Authorization": f"Bearer {resolved_api_key}"},
        )

    async def __aenter__(self) -> Context7:
        """Enter async context manager."""
        return self

    async def __aexit__(self, *args: object) -> None:
        """Exit async context manager and close connections."""
        await self.close()

    async def close(self) -> None:
        """Close the HTTP client connection."""
        await self._http.close()

    async def search_library(self, query: str) -> SearchLibraryResponse:
        """
        Search for libraries by name or description.

        Args:
            query: Search query string.

        Returns:
            SearchLibraryResponse containing matching libraries and metadata.

        Example:
            ```python
            results = await client.search_library("react")
            for lib in results.results:
                print(f"{lib.id}: {lib.title} ({lib.total_tokens} tokens)")
            ```
        """
        result, _ = await self._http.request(
            method="GET",
            path=["v2", "search"],
            query={"query": query},
        )
        return SearchLibraryResponse.model_validate(result)

    @overload
    async def get_docs(
        self,
        library_id: str,
        *,
        format: Literal["txt"],
        version: str | None = None,
        page: int | None = None,
        topic: str | None = None,
        limit: int | None = None,
        mode: Literal["info", "code"] = "code",
    ) -> TextDocsResponse: ...

    @overload
    async def get_docs(
        self,
        library_id: str,
        *,
        mode: Literal["info"],
        format: Literal["json"] = "json",
        version: str | None = None,
        page: int | None = None,
        topic: str | None = None,
        limit: int | None = None,
    ) -> InfoDocsResponse: ...

    @overload
    async def get_docs(
        self,
        library_id: str,
        *,
        mode: Literal["code"] = "code",
        format: Literal["json"] = "json",
        version: str | None = None,
        page: int | None = None,
        topic: str | None = None,
        limit: int | None = None,
    ) -> CodeDocsResponse: ...

    @overload
    async def get_docs(
        self,
        library_id: str,
        *,
        version: str | None = None,
        page: int | None = None,
        topic: str | None = None,
        limit: int | None = None,
        mode: Literal["info", "code"] = "code",
        format: Literal["json", "txt"] = "json",
    ) -> TextDocsResponse | CodeDocsResponse | InfoDocsResponse: ...

    async def get_docs(
        self,
        library_id: str,
        *,
        version: str | None = None,
        page: int | None = None,
        topic: str | None = None,
        limit: int | None = None,
        mode: Literal["info", "code"] = "code",
        format: Literal["json", "txt"] = "json",
    ) -> TextDocsResponse | CodeDocsResponse | InfoDocsResponse:
        """
        Get documentation for a library.

        Args:
            library_id: Library identifier in format "/owner/repo"
                (e.g., "/facebook/react", "/vercel/next.js").
            version: Optional library version (e.g., "18.0.0").
            page: Page number for pagination.
            topic: Filter docs by topic.
            limit: Number of results per page.
            mode: Type of documentation to fetch:
                - "code": Code snippets with examples (default)
                - "info": Text content and explanations
            format: Response format:
                - "json": Structured JSON data (default)
                - "txt": Plain text documentation

        Returns:
            Documentation response. The type depends on mode and format:
            - format="txt": TextDocsResponse with content string
            - mode="code", format="json": CodeDocsResponse with code snippets
            - mode="info", format="json": InfoDocsResponse with info snippets

        Raises:
            Context7ValidationError: If library_id format is invalid.

        Example:
            ```python
            # Get code snippets (default)
            docs = await client.get_docs("/facebook/react")
            for snippet in docs.snippets:
                print(snippet.code_title)

            # Get info documentation
            info = await client.get_docs("/facebook/react", mode="info")
            for snippet in info.snippets:
                print(snippet.content)

            # Get plain text
            text = await client.get_docs("/facebook/react", format="txt")
            print(text.content)

            # With version
            docs = await client.get_docs("/facebook/react", version="18.0.0")
            ```
        """
        # Validate library_id format
        if not library_id.startswith("/") or library_id.count("/") < 2:
            raise Context7ValidationError(
                f"Invalid library ID: {library_id}. Expected format: /owner/repo"
            )

        # Parse library_id: /owner/repo -> ["owner", "repo"]
        parts = library_id.lstrip("/").split("/")
        owner, repo = parts[0], "/".join(parts[1:])

        # Build path
        path = ["v2", "docs", mode, owner, repo]
        if version:
            path.append(version)

        # Build query params
        query = {
            "type": format,
            "page": page,
            "limit": limit,
            "topic": topic,
        }

        result, headers = await self._http.request(
            method="GET",
            path=path,
            query=query,
        )

        # Handle text response
        if format == "txt":
            pagination = Pagination(
                page=headers.page if headers else 1,
                limit=headers.limit if headers else 0,
                totalPages=headers.total_pages if headers else 1,
                hasNext=headers.has_next if headers else False,
                hasPrev=headers.has_prev if headers else False,
            )
            return TextDocsResponse(
                content=result,
                pagination=pagination,
                totalTokens=headers.total_tokens if headers else 0,
            )

        # Handle JSON response
        if mode == "info":
            return InfoDocsResponse.model_validate(result)
        return CodeDocsResponse.model_validate(result)
