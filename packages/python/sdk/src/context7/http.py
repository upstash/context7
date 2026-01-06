"""HTTP client with retry logic for Context7 API."""

from __future__ import annotations

import asyncio
import math
import time
from typing import Any

import httpx
from pydantic import BaseModel

from context7.errors import Context7APIError


class TxtResponseHeaders(BaseModel):
    """Headers extracted from text response for pagination."""

    page: int
    limit: int
    total_pages: int
    has_next: bool
    has_prev: bool
    total_tokens: int


class HttpClient:
    """HTTP client with retry logic for Context7 API (sync and async)."""

    def __init__(
        self,
        base_url: str,
        headers: dict[str, str] | None = None,
        retries: int = 5,
        timeout: float = 30.0,
    ) -> None:
        """
        Initialize the HTTP client.

        Args:
            base_url: Base URL for the API.
            headers: Optional headers to include in all requests.
            retries: Number of retry attempts for failed requests.
            timeout: Request timeout in seconds.
        """
        self.base_url = base_url.rstrip("/")
        self.headers = {"Content-Type": "application/json", **(headers or {})}
        self.retries = retries
        self.timeout = timeout
        self._sync_client: httpx.Client | None = None
        self._async_client: httpx.AsyncClient | None = None

    def _get_sync_client(self) -> httpx.Client:
        """Get or create the sync HTTP client."""
        if self._sync_client is None or self._sync_client.is_closed:
            self._sync_client = httpx.Client(
                base_url=self.base_url,
                headers=self.headers,
                timeout=self.timeout,
            )
        return self._sync_client

    async def _get_async_client(self) -> httpx.AsyncClient:
        """Get or create the async HTTP client."""
        if self._async_client is None or self._async_client.is_closed:
            self._async_client = httpx.AsyncClient(
                base_url=self.base_url,
                headers=self.headers,
                timeout=self.timeout,
            )
        return self._async_client

    def close(self) -> None:
        """Close the sync HTTP client connection."""
        if self._sync_client is not None:
            self._sync_client.close()
            self._sync_client = None

    async def close_async(self) -> None:
        """Close the async HTTP client connection."""
        if self._async_client is not None:
            await self._async_client.aclose()
            self._async_client = None

    def _backoff(self, retry_count: int) -> float:
        """Calculate exponential backoff delay (matches TS SDK)."""
        return math.exp(retry_count) * 0.05

    def request(
        self,
        method: str,
        path: list[str] | None = None,
        query: dict[str, Any] | None = None,
        body: dict[str, Any] | None = None,
    ) -> tuple[Any, TxtResponseHeaders | None]:
        """Make a synchronous HTTP request with retry logic."""
        url = "/".join([self.base_url, *(path or [])])
        params = {k: v for k, v in (query or {}).items() if v is not None}
        client = self._get_sync_client()
        last_error: Exception | None = None

        for attempt in range(self.retries + 1):
            try:
                response = client.request(
                    method=method,
                    url=url,
                    params=params if method == "GET" else None,
                    json=body if method == "POST" else None,
                )
                return self._handle_response(response)
            except httpx.RequestError as e:
                last_error = e
                if attempt < self.retries:
                    time.sleep(self._backoff(attempt))
                continue

        raise last_error or Context7APIError("Exhausted all retries")

    async def request_async(
        self,
        method: str,
        path: list[str] | None = None,
        query: dict[str, Any] | None = None,
        body: dict[str, Any] | None = None,
    ) -> tuple[Any, TxtResponseHeaders | None]:
        """Make an asynchronous HTTP request with retry logic."""
        url = "/".join([self.base_url, *(path or [])])
        params = {k: v for k, v in (query or {}).items() if v is not None}
        client = await self._get_async_client()
        last_error: Exception | None = None

        for attempt in range(self.retries + 1):
            try:
                response = await client.request(
                    method=method,
                    url=url,
                    params=params if method == "GET" else None,
                    json=body if method == "POST" else None,
                )
                return self._handle_response(response)
            except httpx.RequestError as e:
                last_error = e
                if attempt < self.retries:
                    await asyncio.sleep(self._backoff(attempt))
                continue

        raise last_error or Context7APIError("Exhausted all retries")

    def _handle_response(self, response: httpx.Response) -> tuple[Any, TxtResponseHeaders | None]:
        """Handle HTTP response (shared between sync and async)."""
        if not response.is_success:
            try:
                error_body = response.json()
                message = (
                    error_body.get("error") or error_body.get("message") or response.reason_phrase
                )
            except (ValueError, KeyError, TypeError):
                message = response.reason_phrase or "Unknown error"
            raise Context7APIError(message, status_code=response.status_code)

        content_type = response.headers.get("content-type", "")

        if "application/json" in content_type:
            return response.json(), None
        else:
            headers = self._extract_txt_headers(response.headers)
            return response.text, headers

    def _extract_txt_headers(self, headers: httpx.Headers) -> TxtResponseHeaders | None:
        """Extract pagination headers from text response."""
        try:
            return TxtResponseHeaders(
                page=int(headers.get("x-context7-page", 0)),
                limit=int(headers.get("x-context7-limit", 0)),
                total_pages=int(headers.get("x-context7-total-pages", 0)),
                has_next=headers.get("x-context7-has-next", "false").lower() == "true",
                has_prev=headers.get("x-context7-has-prev", "false").lower() == "true",
                total_tokens=int(headers.get("x-context7-total-tokens", 0)),
            )
        except (ValueError, TypeError):
            return None
