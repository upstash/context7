"""Tests for the Context7 client."""

import os

import pytest
from context7 import Context7, Context7Error, Context7ValidationError


@pytest.fixture
def api_key() -> str:
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

    def test_init_with_invalid_prefix_warns(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Test that invalid API key prefix produces a warning."""
        monkeypatch.delenv("CONTEXT7_API_KEY", raising=False)
        with pytest.warns(UserWarning, match="API key should start with"):
            Context7(api_key="invalid_key")


class TestSearchLibrarySync:
    """Tests for the synchronous search_library method."""

    def test_search_library(self, api_key: str) -> None:
        """Test basic library search (sync)."""
        with Context7(api_key=api_key) as client:
            response = client.search_library("react")
            assert response.results is not None
            assert len(response.results) > 0
            assert response.metadata is not None

    def test_search_library_result_fields(self, api_key: str) -> None:
        """Test that search results have expected fields (sync)."""
        with Context7(api_key=api_key) as client:
            response = client.search_library("react")
            if response.results:
                result = response.results[0]
                assert result.id is not None
                assert result.title is not None
                assert result.total_tokens >= 0


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

    @pytest.mark.asyncio
    async def test_search_library_async_result_fields(self, api_key: str) -> None:
        """Test that search results have expected fields (async)."""
        async with Context7(api_key=api_key) as client:
            response = await client.search_library_async("react")
            if response.results:
                result = response.results[0]
                assert result.id is not None
                assert result.title is not None
                assert result.total_tokens >= 0


class TestGetDocsSync:
    """Tests for the synchronous get_docs method."""

    def test_get_docs_code_default(self, api_key: str) -> None:
        """Test getting code documentation (default mode, sync)."""
        with Context7(api_key=api_key) as client:
            response = client.get_docs("/facebook/react")
            assert response.snippets is not None
            assert response.pagination is not None
            assert response.total_tokens >= 0

    def test_get_docs_info_mode(self, api_key: str) -> None:
        """Test getting info documentation (sync)."""
        with Context7(api_key=api_key) as client:
            response = client.get_docs("/facebook/react", mode="info")
            assert response.snippets is not None
            assert response.pagination is not None

    def test_get_docs_txt_format(self, api_key: str) -> None:
        """Test getting plain text documentation (sync)."""
        with Context7(api_key=api_key) as client:
            response = client.get_docs("/facebook/react", format="txt")
            assert response.content is not None
            assert isinstance(response.content, str)
            assert len(response.content) > 0

    def test_get_docs_with_pagination(self, api_key: str) -> None:
        """Test documentation pagination (sync)."""
        with Context7(api_key=api_key) as client:
            response = client.get_docs("/facebook/react", page=1, limit=5)
            assert response.pagination is not None
            assert response.pagination.page == 1
            assert response.pagination.limit == 5

    def test_get_docs_invalid_library_id(self, api_key: str) -> None:
        """Test that invalid library ID raises validation error (sync)."""
        with Context7(api_key=api_key) as client:
            with pytest.raises(Context7ValidationError, match="Invalid library ID"):
                client.get_docs("invalid-id")

    def test_get_docs_invalid_library_id_no_slash(self, api_key: str) -> None:
        """Test that library ID without leading slash raises error (sync)."""
        with Context7(api_key=api_key) as client:
            with pytest.raises(Context7ValidationError):
                client.get_docs("facebook/react")


class TestGetDocsAsync:
    """Tests for the asynchronous get_docs_async method."""

    @pytest.mark.asyncio
    async def test_get_docs_async_code_default(self, api_key: str) -> None:
        """Test getting code documentation (default mode, async)."""
        async with Context7(api_key=api_key) as client:
            response = await client.get_docs_async("/facebook/react")
            assert response.snippets is not None
            assert response.pagination is not None
            assert response.total_tokens >= 0

    @pytest.mark.asyncio
    async def test_get_docs_async_info_mode(self, api_key: str) -> None:
        """Test getting info documentation (async)."""
        async with Context7(api_key=api_key) as client:
            response = await client.get_docs_async("/facebook/react", mode="info")
            assert response.snippets is not None
            assert response.pagination is not None

    @pytest.mark.asyncio
    async def test_get_docs_async_txt_format(self, api_key: str) -> None:
        """Test getting plain text documentation (async)."""
        async with Context7(api_key=api_key) as client:
            response = await client.get_docs_async("/facebook/react", format="txt")
            assert response.content is not None
            assert isinstance(response.content, str)
            assert len(response.content) > 0

    @pytest.mark.asyncio
    async def test_get_docs_async_with_pagination(self, api_key: str) -> None:
        """Test documentation pagination (async)."""
        async with Context7(api_key=api_key) as client:
            response = await client.get_docs_async("/facebook/react", page=1, limit=5)
            assert response.pagination is not None
            assert response.pagination.page == 1
            assert response.pagination.limit == 5

    @pytest.mark.asyncio
    async def test_get_docs_async_invalid_library_id(self, api_key: str) -> None:
        """Test that invalid library ID raises validation error (async)."""
        async with Context7(api_key=api_key) as client:
            with pytest.raises(Context7ValidationError, match="Invalid library ID"):
                await client.get_docs_async("invalid-id")

    @pytest.mark.asyncio
    async def test_get_docs_async_invalid_library_id_no_slash(self, api_key: str) -> None:
        """Test that library ID without leading slash raises error (async)."""
        async with Context7(api_key=api_key) as client:
            with pytest.raises(Context7ValidationError):
                await client.get_docs_async("facebook/react")


class TestSyncContextManager:
    """Tests for sync context manager behavior."""

    def test_context_manager(self, api_key: str) -> None:
        """Test that sync context manager properly opens and closes."""
        with Context7(api_key=api_key) as client:
            response = client.search_library("react")
            assert response is not None

    def test_manual_close(self, api_key: str) -> None:
        """Test manual close method (sync)."""
        client = Context7(api_key=api_key)
        response = client.search_library("react")
        assert response is not None
        client.close()


class TestAsyncContextManager:
    """Tests for async context manager behavior."""

    @pytest.mark.asyncio
    async def test_context_manager_async(self, api_key: str) -> None:
        """Test that async context manager properly opens and closes."""
        async with Context7(api_key=api_key) as client:
            response = await client.search_library_async("react")
            assert response is not None

    @pytest.mark.asyncio
    async def test_manual_close_async(self, api_key: str) -> None:
        """Test manual close method (async)."""
        client = Context7(api_key=api_key)
        response = await client.search_library_async("react")
        assert response is not None
        await client.close_async()
