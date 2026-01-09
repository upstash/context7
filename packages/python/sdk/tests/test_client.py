"""Tests for the Context7 client."""

import os

import pytest
from context7 import Context7, Context7Error, Documentation, Library


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

    def test_init_with_invalid_prefix_warns(self, monkeypatch: pytest.MonkeyPatch) -> None:
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
            libraries = client.search_library("I need a UI library", "react")
            assert libraries is not None
            assert len(libraries) > 0
            assert isinstance(libraries, list)

    def test_search_library_result_fields(self, api_key: str) -> None:
        """Test that search results have expected fields (sync)."""
        with Context7(api_key=api_key) as client:
            libraries = client.search_library("I need a UI library", "react")
            assert len(libraries) > 0
            lib = libraries[0]
            assert isinstance(lib, Library)
            assert lib.id is not None
            assert isinstance(lib.id, str)
            assert lib.name is not None
            assert isinstance(lib.name, str)
            assert lib.description is not None
            assert lib.total_snippets >= 0
            assert lib.trust_score >= 0
            assert lib.benchmark_score >= 0

    def test_search_library_different_queries(self, api_key: str) -> None:
        """Test search with different queries returns different results."""
        with Context7(api_key=api_key) as client:
            react_results = client.search_library("I need a UI library", "react")
            vue_results = client.search_library("I need a UI library", "vue")
            assert react_results[0].id != vue_results[0].id

    def test_search_library_specific_query(self, api_key: str) -> None:
        """Test search with specific query returns relevant results."""
        with Context7(api_key=api_key) as client:
            libraries = client.search_library("I need a server framework", "nextjs")
            assert libraries is not None
            assert len(libraries) > 0
            # Results should contain nextjs-related libraries
            names = [lib.name.lower() for lib in libraries]
            assert any("next" in n for n in names)


class TestSearchLibraryAsync:
    """Tests for the asynchronous search_library_async method."""

    @pytest.mark.asyncio
    async def test_search_library_async(self, api_key: str) -> None:
        """Test basic library search (async)."""
        async with Context7(api_key=api_key) as client:
            libraries = await client.search_library_async("I need a UI library", "react")
            assert libraries is not None
            assert len(libraries) > 0
            assert isinstance(libraries, list)

    @pytest.mark.asyncio
    async def test_search_library_async_result_fields(self, api_key: str) -> None:
        """Test that search results have expected fields (async)."""
        async with Context7(api_key=api_key) as client:
            libraries = await client.search_library_async("I need a UI library", "react")
            assert len(libraries) > 0
            lib = libraries[0]
            assert isinstance(lib, Library)
            assert lib.id is not None
            assert isinstance(lib.id, str)
            assert lib.name is not None
            assert isinstance(lib.name, str)
            assert lib.description is not None
            assert lib.total_snippets >= 0
            assert lib.trust_score >= 0
            assert lib.benchmark_score >= 0


class TestGetContextSync:
    """Tests for the synchronous get_context method."""

    def test_get_context_json_default(self, api_key: str) -> None:
        """Test getting context as JSON (default, sync)."""
        with Context7(api_key=api_key) as client:
            docs = client.get_context("How to use hooks", "/facebook/react")
            assert isinstance(docs, list)
            assert len(docs) > 0

    def test_get_context_text(self, api_key: str) -> None:
        """Test getting context as text (sync)."""
        with Context7(api_key=api_key) as client:
            context = client.get_context("How to use hooks", "/facebook/react", type="txt")
            assert isinstance(context, str)
            assert len(context) > 0

    def test_get_context_json_fields(self, api_key: str) -> None:
        """Test that JSON documentation has all expected fields."""
        with Context7(api_key=api_key) as client:
            docs = client.get_context("How to use hooks", "/facebook/react")
            assert len(docs) > 0
            doc = docs[0]
            assert isinstance(doc, Documentation)
            assert doc.title is not None
            assert isinstance(doc.title, str)
            assert doc.content is not None
            assert isinstance(doc.content, str)
            assert doc.source is not None
            assert isinstance(doc.source, str)


class TestGetContextAsync:
    """Tests for the asynchronous get_context_async method."""

    @pytest.mark.asyncio
    async def test_get_context_async_json_default(self, api_key: str) -> None:
        """Test getting context as JSON (default, async)."""
        async with Context7(api_key=api_key) as client:
            docs = await client.get_context_async("How to use hooks", "/facebook/react")
            assert isinstance(docs, list)
            assert len(docs) > 0

    @pytest.mark.asyncio
    async def test_get_context_async_text(self, api_key: str) -> None:
        """Test getting context as text (async)."""
        async with Context7(api_key=api_key) as client:
            context = await client.get_context_async(
                "How to use hooks", "/facebook/react", type="txt"
            )
            assert isinstance(context, str)
            assert len(context) > 0

    @pytest.mark.asyncio
    async def test_get_context_async_json_fields(self, api_key: str) -> None:
        """Test that JSON documentation has all expected fields (async)."""
        async with Context7(api_key=api_key) as client:
            docs = await client.get_context_async("How to use hooks", "/facebook/react")
            assert len(docs) > 0
            doc = docs[0]
            assert isinstance(doc, Documentation)
            assert doc.title is not None
            assert isinstance(doc.title, str)
            assert doc.content is not None
            assert isinstance(doc.content, str)
            assert doc.source is not None
            assert isinstance(doc.source, str)


class TestSyncContextManager:
    """Tests for sync context manager behavior."""

    def test_context_manager(self, api_key: str) -> None:
        """Test that sync context manager properly opens and closes."""
        with Context7(api_key=api_key) as client:
            assert client is not None
            libraries = client.search_library("I need a UI library", "react")
            assert libraries is not None
            assert len(libraries) > 0

    def test_manual_close(self, api_key: str) -> None:
        """Test manual close method (sync)."""
        client = Context7(api_key=api_key)
        libraries = client.search_library("I need a UI library", "react")
        assert libraries is not None
        assert len(libraries) > 0
        client.close()
        # Client should still exist but HTTP client should be closed
        assert client._http._sync_client is None

    def test_multiple_requests_same_client(self, api_key: str) -> None:
        """Test making multiple requests with same client."""
        with Context7(api_key=api_key) as client:
            libraries1 = client.search_library("I need a UI library", "react")
            libraries2 = client.search_library("I need a UI library", "vue")
            docs = client.get_context("How to use hooks", "/facebook/react")
            assert libraries1 is not None
            assert libraries2 is not None
            assert docs is not None
            assert isinstance(docs, list)


class TestAsyncContextManager:
    """Tests for async context manager behavior."""

    @pytest.mark.asyncio
    async def test_context_manager_async(self, api_key: str) -> None:
        """Test that async context manager properly opens and closes."""
        async with Context7(api_key=api_key) as client:
            assert client is not None
            libraries = await client.search_library_async("I need a UI library", "react")
            assert libraries is not None
            assert len(libraries) > 0

    @pytest.mark.asyncio
    async def test_manual_close_async(self, api_key: str) -> None:
        """Test manual close method (async)."""
        client = Context7(api_key=api_key)
        libraries = await client.search_library_async("I need a UI library", "react")
        assert libraries is not None
        assert len(libraries) > 0
        await client.close_async()
        # Client should still exist but HTTP client should be closed
        assert client._http._async_client is None

    @pytest.mark.asyncio
    async def test_multiple_requests_same_client_async(self, api_key: str) -> None:
        """Test making multiple async requests with same client."""
        async with Context7(api_key=api_key) as client:
            libraries1 = await client.search_library_async("I need a UI library", "react")
            libraries2 = await client.search_library_async("I need a UI library", "vue")
            docs = await client.get_context_async("How to use hooks", "/facebook/react")
            assert libraries1 is not None
            assert libraries2 is not None
            assert docs is not None
            assert isinstance(docs, list)
