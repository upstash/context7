"""Tests for the Context7 client."""

import os

import pytest
from context7 import Context7, Context7Error, Context7ValidationError
from context7.models import (
    CodeDocsResponse,
    CodeSnippet,
    InfoDocsResponse,
    InfoSnippet,
    SearchResult,
    TextDocsResponse,
)


@pytest.fixture(name="api_key")
def api_key_fixture() -> str:
    """Get API key from environment or skip test."""
    key = os.environ.get("CONTEXT7_API_KEY")
    if not key:
        pytest.skip("CONTEXT7_API_KEY not set")
    return key


class TestContext7Init:
    """Tests for Context7 client initialization."""

    def test_init_with_api_key(self, api_key: str) -> None:
        """Test client initialization with explicit API key."""
        client = Context7(api_key=api_key)
        assert client is not None
        assert client._http is not None

    def test_init_without_api_key_raises(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Test that missing API key raises an error."""
        monkeypatch.delenv("CONTEXT7_API_KEY", raising=False)
        with pytest.raises(Context7Error, match="API key is required"):
            Context7()

    def test_init_from_env(self, api_key: str, monkeypatch: pytest.MonkeyPatch) -> None:
        """Test client initialization from environment variable."""
        monkeypatch.setenv("CONTEXT7_API_KEY", api_key)
        client = Context7()
        assert client is not None
        assert client._http is not None

    def test_init_with_invalid_prefix_warns(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Test that invalid API key prefix produces a warning."""
        monkeypatch.delenv("CONTEXT7_API_KEY", raising=False)
        with pytest.warns(UserWarning, match="API key should start with"):
            Context7(api_key="invalid_key")

    def test_init_with_custom_base_url(self, api_key: str) -> None:
        """Test client initialization with custom base URL."""
        custom_url = "https://custom.context7.com/api"
        client = Context7(api_key=api_key, base_url=custom_url)
        assert client is not None
        assert client._http.base_url == custom_url


class TestSearchLibrarySync:
    """Tests for the synchronous search_library method."""

    def test_search_library(self, api_key: str) -> None:
        """Test basic library search (sync)."""
        with Context7(api_key=api_key) as client:
            response = client.search_library("react")
            assert response.results is not None
            assert len(response.results) > 0
            assert response.metadata is not None
            assert response.metadata.authentication is not None

    def test_search_library_result_fields(self, api_key: str) -> None:
        """Test that search results have expected fields (sync)."""
        with Context7(api_key=api_key) as client:
            response = client.search_library("react")
            assert len(response.results) > 0
            result = response.results[0]
            assert isinstance(result, SearchResult)
            assert result.id is not None
            assert isinstance(result.id, str)
            assert result.title is not None
            assert isinstance(result.title, str)
            assert result.description is not None
            assert result.branch is not None
            assert result.state is not None
            assert result.total_tokens >= 0
            assert result.total_snippets >= 0

    def test_search_library_different_queries(self, api_key: str) -> None:
        """Test search with different queries returns different results."""
        with Context7(api_key=api_key) as client:
            react_results = client.search_library("react")
            vue_results = client.search_library("vue")
            assert react_results.results[0].id != vue_results.results[0].id

    def test_search_library_specific_query(self, api_key: str) -> None:
        """Test search with specific query returns relevant results."""
        with Context7(api_key=api_key) as client:
            response = client.search_library("nextjs")
            assert response.results is not None
            assert len(response.results) > 0
            # Results should contain nextjs-related libraries
            titles = [r.title.lower() for r in response.results]
            assert any("next" in t for t in titles)


class TestSearchLibraryAsync:
    """Tests for the asynchronous search_library_async method."""

    @pytest.mark.asyncio
    async def test_search_library_async(self, api_key: str) -> None:
        """Test basic library search (async)."""
        async with Context7(api_key=api_key) as client:
            response = await client.search_library_async("react")
            assert response.results is not None
            assert len(response.results) > 0
            assert response.metadata is not None
            assert response.metadata.authentication is not None

    @pytest.mark.asyncio
    async def test_search_library_async_result_fields(self, api_key: str) -> None:
        """Test that search results have expected fields (async)."""
        async with Context7(api_key=api_key) as client:
            response = await client.search_library_async("react")
            assert len(response.results) > 0
            result = response.results[0]
            assert isinstance(result, SearchResult)
            assert result.id is not None
            assert isinstance(result.id, str)
            assert result.title is not None
            assert isinstance(result.title, str)
            assert result.description is not None
            assert result.branch is not None
            assert result.state is not None
            assert result.total_tokens >= 0
            assert result.total_snippets >= 0


class TestGetDocsSync:
    """Tests for the synchronous get_docs method."""

    def test_get_docs_code_default(self, api_key: str) -> None:
        """Test getting code documentation (default mode, sync)."""
        with Context7(api_key=api_key) as client:
            response = client.get_docs("/facebook/react")
            assert isinstance(response, CodeDocsResponse)
            assert response.snippets is not None
            assert len(response.snippets) > 0
            assert response.pagination is not None
            assert response.pagination.page >= 1
            assert response.total_tokens >= 0

    def test_get_docs_code_snippet_fields(self, api_key: str) -> None:
        """Test that code snippets have all expected fields."""
        with Context7(api_key=api_key) as client:
            response = client.get_docs("/facebook/react")
            assert len(response.snippets) > 0
            snippet = response.snippets[0]
            assert isinstance(snippet, CodeSnippet)
            assert snippet.code_title is not None
            assert snippet.code_description is not None
            assert snippet.code_language is not None
            assert snippet.code_tokens >= 0
            assert snippet.code_id is not None
            assert snippet.page_title is not None
            assert snippet.code_list is not None
            assert len(snippet.code_list) > 0

    def test_get_docs_info_mode(self, api_key: str) -> None:
        """Test getting info documentation (sync)."""
        with Context7(api_key=api_key) as client:
            response = client.get_docs("/facebook/react", mode="info")
            assert isinstance(response, InfoDocsResponse)
            assert response.snippets is not None
            assert len(response.snippets) > 0
            assert response.pagination is not None
            assert response.total_tokens >= 0

    def test_get_docs_info_snippet_fields(self, api_key: str) -> None:
        """Test that info snippets have all expected fields."""
        with Context7(api_key=api_key) as client:
            response = client.get_docs("/facebook/react", mode="info")
            assert len(response.snippets) > 0
            snippet = response.snippets[0]
            assert isinstance(snippet, InfoSnippet)
            assert snippet.content is not None
            assert isinstance(snippet.content, str)
            assert snippet.content_tokens >= 0

    def test_get_docs_txt_format(self, api_key: str) -> None:
        """Test getting plain text documentation (sync)."""
        with Context7(api_key=api_key) as client:
            response = client.get_docs("/facebook/react", format="txt")
            assert isinstance(response, TextDocsResponse)
            assert response.content is not None
            assert isinstance(response.content, str)
            assert len(response.content) > 0
            assert response.pagination is not None
            assert response.total_tokens >= 0

    def test_get_docs_with_pagination(self, api_key: str) -> None:
        """Test documentation pagination (sync)."""
        with Context7(api_key=api_key) as client:
            response = client.get_docs("/facebook/react", page=1, limit=5)
            assert response.pagination is not None
            assert response.pagination.page == 1
            assert response.pagination.limit == 5
            assert isinstance(response.pagination.has_next, bool)
            assert isinstance(response.pagination.has_prev, bool)
            assert response.pagination.total_pages >= 1

    def test_get_docs_pagination_page_2(self, api_key: str) -> None:
        """Test fetching second page of documentation."""
        with Context7(api_key=api_key) as client:
            page1 = client.get_docs("/facebook/react", page=1, limit=3)
            page2 = client.get_docs("/facebook/react", page=2, limit=3)
            assert page1.pagination.page == 1
            assert page2.pagination.page == 2
            # Content should be different between pages
            if page1.snippets and page2.snippets:
                assert page1.snippets[0].code_id != page2.snippets[0].code_id

    def test_get_docs_with_topic(self, api_key: str) -> None:
        """Test filtering documentation by topic."""
        with Context7(api_key=api_key) as client:
            response = client.get_docs("/facebook/react", topic="hooks")
            assert response.snippets is not None
            assert response.pagination is not None

    def test_get_docs_invalid_library_id(self, api_key: str) -> None:
        """Test that invalid library ID raises validation error (sync)."""
        with (
            Context7(api_key=api_key) as client,
            pytest.raises(Context7ValidationError, match="Invalid library ID"),
        ):
            client.get_docs("invalid-id")

    def test_get_docs_invalid_library_id_no_slash(self, api_key: str) -> None:
        """Test that library ID without leading slash raises error (sync)."""
        with (
            Context7(api_key=api_key) as client,
            pytest.raises(Context7ValidationError, match="Expected format"),
        ):
            client.get_docs("facebook/react")

    def test_get_docs_invalid_library_id_single_segment(self, api_key: str) -> None:
        """Test that single segment library ID raises error."""
        with Context7(api_key=api_key) as client, pytest.raises(Context7ValidationError):
            client.get_docs("/react")


class TestGetDocsAsync:
    """Tests for the asynchronous get_docs_async method."""

    @pytest.mark.asyncio
    async def test_get_docs_async_code_default(self, api_key: str) -> None:
        """Test getting code documentation (default mode, async)."""
        async with Context7(api_key=api_key) as client:
            response = await client.get_docs_async("/facebook/react")
            assert isinstance(response, CodeDocsResponse)
            assert response.snippets is not None
            assert len(response.snippets) > 0
            assert response.pagination is not None
            assert response.pagination.page >= 1
            assert response.total_tokens >= 0

    @pytest.mark.asyncio
    async def test_get_docs_async_code_snippet_fields(self, api_key: str) -> None:
        """Test that code snippets have all expected fields (async)."""
        async with Context7(api_key=api_key) as client:
            response = await client.get_docs_async("/facebook/react")
            assert len(response.snippets) > 0
            snippet = response.snippets[0]
            assert isinstance(snippet, CodeSnippet)
            assert snippet.code_title is not None
            assert snippet.code_description is not None
            assert snippet.code_language is not None
            assert snippet.code_tokens >= 0
            assert snippet.code_id is not None

    @pytest.mark.asyncio
    async def test_get_docs_async_info_mode(self, api_key: str) -> None:
        """Test getting info documentation (async)."""
        async with Context7(api_key=api_key) as client:
            response = await client.get_docs_async("/facebook/react", mode="info")
            assert isinstance(response, InfoDocsResponse)
            assert response.snippets is not None
            assert len(response.snippets) > 0
            assert response.pagination is not None
            assert response.total_tokens >= 0

    @pytest.mark.asyncio
    async def test_get_docs_async_txt_format(self, api_key: str) -> None:
        """Test getting plain text documentation (async)."""
        async with Context7(api_key=api_key) as client:
            response = await client.get_docs_async("/facebook/react", format="txt")
            assert isinstance(response, TextDocsResponse)
            assert response.content is not None
            assert isinstance(response.content, str)
            assert len(response.content) > 0
            assert response.pagination is not None
            assert response.total_tokens >= 0

    @pytest.mark.asyncio
    async def test_get_docs_async_with_pagination(self, api_key: str) -> None:
        """Test documentation pagination (async)."""
        async with Context7(api_key=api_key) as client:
            response = await client.get_docs_async("/facebook/react", page=1, limit=5)
            assert response.pagination is not None
            assert response.pagination.page == 1
            assert response.pagination.limit == 5
            assert isinstance(response.pagination.has_next, bool)
            assert isinstance(response.pagination.has_prev, bool)
            assert response.pagination.total_pages >= 1

    @pytest.mark.asyncio
    async def test_get_docs_async_invalid_library_id(self, api_key: str) -> None:
        """Test that invalid library ID raises validation error (async)."""
        async with Context7(api_key=api_key) as client:
            with pytest.raises(Context7ValidationError, match="Invalid library ID"):
                await client.get_docs_async("invalid-id")

    @pytest.mark.asyncio
    async def test_get_docs_async_invalid_library_id_no_slash(
        self, api_key: str
    ) -> None:
        """Test that library ID without leading slash raises error (async)."""
        async with Context7(api_key=api_key) as client:
            with pytest.raises(Context7ValidationError, match="Expected format"):
                await client.get_docs_async("facebook/react")


class TestSyncContextManager:
    """Tests for sync context manager behavior."""

    def test_context_manager(self, api_key: str) -> None:
        """Test that sync context manager properly opens and closes."""
        with Context7(api_key=api_key) as client:
            assert client is not None
            response = client.search_library("react")
            assert response is not None
            assert len(response.results) > 0

    def test_manual_close(self, api_key: str) -> None:
        """Test manual close method (sync)."""
        client = Context7(api_key=api_key)
        response = client.search_library("react")
        assert response is not None
        assert len(response.results) > 0
        client.close()
        # Client should still exist but HTTP client should be closed
        assert client._http._sync_client is None

    def test_multiple_requests_same_client(self, api_key: str) -> None:
        """Test making multiple requests with same client."""
        with Context7(api_key=api_key) as client:
            response1 = client.search_library("react")
            response2 = client.search_library("vue")
            response3 = client.get_docs("/facebook/react", limit=2)
            assert response1.results is not None
            assert response2.results is not None
            assert response3.snippets is not None


class TestAsyncContextManager:
    """Tests for async context manager behavior."""

    @pytest.mark.asyncio
    async def test_context_manager_async(self, api_key: str) -> None:
        """Test that async context manager properly opens and closes."""
        async with Context7(api_key=api_key) as client:
            assert client is not None
            response = await client.search_library_async("react")
            assert response is not None
            assert len(response.results) > 0

    @pytest.mark.asyncio
    async def test_manual_close_async(self, api_key: str) -> None:
        """Test manual close method (async)."""
        client = Context7(api_key=api_key)
        response = await client.search_library_async("react")
        assert response is not None
        assert len(response.results) > 0
        await client.close_async()
        # Client should still exist but HTTP client should be closed
        assert client._http._async_client is None

    @pytest.mark.asyncio
    async def test_multiple_requests_same_client_async(self, api_key: str) -> None:
        """Test making multiple async requests with same client."""
        async with Context7(api_key=api_key) as client:
            response1 = await client.search_library_async("react")
            response2 = await client.search_library_async("vue")
            response3 = await client.get_docs_async("/facebook/react", limit=2)
            assert response1.results is not None
            assert response2.results is not None
            assert response3.snippets is not None


class TestLibraryIdValidation:
    """Tests for library ID validation edge cases."""

    def test_valid_library_id_formats(self, api_key: str) -> None:
        """Test various valid library ID formats."""
        with Context7(api_key=api_key) as client:
            # Standard format
            response = client.get_docs("/facebook/react", limit=1)
            assert response is not None

    def test_library_id_with_nested_path(self, api_key: str) -> None:
        """Test library ID with nested repo path."""
        with Context7(api_key=api_key) as client:
            # Some repos have nested paths like /org/repo/subpath
            # The SDK should handle this correctly
            response = client.get_docs("/vercel/next.js", limit=1)
            assert response is not None

    def test_invalid_library_id_formats(self, api_key: str) -> None:
        """Test various invalid library ID formats."""
        with Context7(api_key=api_key) as client:
            invalid_ids = [
                "no-slash",
                "single/segment",
                "/only-owner",
            ]
            for invalid_id in invalid_ids:
                with pytest.raises(Context7ValidationError):
                    client.get_docs(invalid_id)
